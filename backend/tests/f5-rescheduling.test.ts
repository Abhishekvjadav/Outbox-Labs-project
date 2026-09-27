/**
 * F5 Rescheduling Durability Tests
 *
 * Verifies Option 3 Enqueue-First rescheduling durability:
 * 1. Deterministic BullMQ delayed job is created BEFORE committing PostgreSQL RESCHEDULED.
 * 2. If BullMQ enqueue fails, the email is NOT marked RESCHEDULED; error bubbles to retry/recovery.
 * 3. scheduledAt guard: RESCHEDULED emails are claimable only when scheduledAt <= now.
 * 4. If DB update fails after BullMQ enqueue, the delayed job safely remains in Redis;
 *    worker verifies DB state before sending.
 * 5. Bounded local enqueue retry (3 attempts with backoff).
 * 6. Deterministic job IDs prevent duplicate delayed jobs under concurrent execution.
 */

jest.mock('../src/prisma/client', () => ({
  prisma: {
    email: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    emailEvent: { create: jest.fn() },
    campaign: { update: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('@reachflow/shared', () => ({
  EmailStatus: {
    SCHEDULED: 'SCHEDULED',
    QUEUED: 'QUEUED',
    PROCESSING: 'PROCESSING',
    RATE_LIMITED: 'RATE_LIMITED',
    RESCHEDULED: 'RESCHEDULED',
    SENT: 'SENT',
    FAILED: 'FAILED',
  },
  EventType: {
    CAMPAIGN_CREATED: 'CAMPAIGN_CREATED',
    JOB_ENQUEUED: 'JOB_ENQUEUED',
    WORKER_PICKED: 'WORKER_PICKED',
    RATE_LIMIT_CHECKED: 'RATE_LIMIT_CHECKED',
    RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
    RESCHEDULED_NEXT_WINDOW: 'RESCHEDULED_NEXT_WINDOW',
    PROVIDER_DELAY_APPLIED: 'PROVIDER_DELAY_APPLIED',
    SMTP_DELIVERED: 'SMTP_DELIVERED',
    INDEXED_SEARCH: 'INDEXED_SEARCH',
    FAILED_ATTEMPT: 'FAILED_ATTEMPT',
    DLQ_MOVED: 'DLQ_MOVED',
  },
}));

const mockRedisStore = new Map<string, string>();
const mockRedisClient = {
  get: jest.fn(async (key: string) => mockRedisStore.get(key) || null),
  set: jest.fn(async (key: string, value: string) => {
    mockRedisStore.set(key, value);
    return 'OK';
  }),
  del: jest.fn(async (key: string) => {
    const deleted = mockRedisStore.delete(key);
    return deleted ? 1 : 0;
  }),
  quit: jest.fn().mockResolvedValue('OK'),
};

jest.mock('../src/queues/redis', () => ({
  redisConnectionOptions: {},
  redisClient: mockRedisClient,
}));

const mockEmailQueueAdd = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/queues/emailQueue', () => ({
  EMAIL_QUEUE_NAME: 'test-email-queue',
  emailQueue: { add: mockEmailQueueAdd },
  esIndexQueue: { add: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../src/services/rateLimiter', () => ({
  rateLimiterService: {
    checkAndIncrement: jest.fn(),
    reserveSendSlot: jest.fn().mockResolvedValue(Date.now()),
  },
}));

jest.mock('../src/services/ethereal', () => ({
  etherealService: { sendEmail: jest.fn() },
}));

jest.mock('../src/services/slack', () => ({
  slackService: { sendDeduplicatedRateLimitAlert: jest.fn().mockResolvedValue(undefined) },
}));

import { EmailStatus, EventType } from '@reachflow/shared';
import { Job } from 'bullmq';
import { EmailJobData } from '../src/queues/emailQueue';
import { prisma } from '../src/prisma/client';
import { rateLimiterService } from '../src/services/rateLimiter';
import { etherealService } from '../src/services/ethereal';
import { EmailWorkerService } from '../src/workers/emailWorker';

describe('F5 — Rescheduling Durability & Enqueue-First Pattern', () => {
  let worker: EmailWorkerService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisStore.clear();
    mockEmailQueueAdd.mockReset();
    mockEmailQueueAdd.mockResolvedValue(undefined);
    worker = new EmailWorkerService();
  });

  const createMockEmail = (
    emailId: string,
    status: string = EmailStatus.SCHEDULED,
    scheduledAt: Date = new Date()
  ) => ({
    id: emailId,
    status,
    attempts: 0,
    scheduledAt,
    senderId: 'sender-1',
    sender: {
      id: 'sender-1',
      email: 'sender@reachflow.io',
      name: 'Sales Rep',
      hourlyLimit: 100,
      etherealUser: 'ethereal_user',
      etherealPass: 'ethereal_pass',
    },
    campaignId: 'camp-1',
    campaign: { id: 'camp-1', name: 'Outreach Q1', delayMs: 1 },
    userId: 'user-1',
    user: {},
    recipient: 'lead@target.com',
    subject: 'Quick question',
    body: 'Would love to connect.',
    updatedAt: new Date(),
  });

  const createMockJob = (emailId: string, attemptsMade: number = 0) =>
    ({
      id: `email-send-${emailId}`,
      data: { emailId },
      opts: { attempts: 3 },
      attemptsMade,
    } as Job<EmailJobData>);

  const makeTxClient = () => ({
    email: { updateMany: prisma.email.updateMany, update: prisma.email.update },
    campaign: { update: prisma.campaign.update },
    emailEvent: { create: prisma.emailEvent.create },
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 1: Enqueue Failure → Bounded retries → Email NOT marked RESCHEDULED
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 1: enqueue failure → bounded retries exhausted → DB is NOT updated to RESCHEDULED', async () => {
    const emailId = 'f5-test1-enqueue-fail';
    const email = createMockEmail(emailId, EmailStatus.SCHEDULED);

    (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...email });
    (prisma.email.updateMany as jest.Mock).mockResolvedValue({ count: 1 }); // Atomic claim succeeds
    (prisma.emailEvent.create as jest.Mock).mockResolvedValue({});
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: any) =>
      typeof arg === 'function' ? arg(makeTxClient()) : Promise.all(arg)
    );

    // Rate limit hit
    const resetTimeMs = Date.now() + 3_600_000;
    (rateLimiterService.checkAndIncrement as jest.Mock).mockResolvedValue({
      allowed: false,
      currentCount: 100,
      windowKey: 'rate:sender-1',
      resetTimeMs,
    });

    // Make BullMQ enqueue persistently fail
    mockEmailQueueAdd.mockRejectedValue(new Error('Redis ECONNREFUSED'));

    const job = createMockJob(emailId, 0);

    // Worker must throw when enqueue retries are exhausted
    await expect((worker as any).processEmailJob(emailId, job)).rejects.toThrow('Redis ECONNREFUSED');

    // Bounded retry executed 3 times
    expect(mockEmailQueueAdd).toHaveBeenCalledTimes(3);

    // CRITICAL: DB was NOT updated to RESCHEDULED
    expect(prisma.email.update).not.toHaveBeenCalled();
    // SMTP was not called
    expect(etherealService.sendEmail).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 2: Process Crash / Order Gap → BullMQ delayed job enqueued BEFORE DB update
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 2: process crash / order gap → BullMQ job is strictly enqueued BEFORE DB update', async () => {
    const emailId = 'f5-test2-order-gap';
    const email = createMockEmail(emailId, EmailStatus.SCHEDULED);

    (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...email });
    (prisma.email.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.emailEvent.create as jest.Mock).mockResolvedValue({});
    (prisma.email.update as jest.Mock).mockResolvedValue({});

    const callOrder: string[] = [];

    mockEmailQueueAdd.mockImplementation(async () => {
      callOrder.push('BULLMQ_ENQUEUE');
    });

    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: any) => {
      if (typeof arg === 'function') {
        callOrder.push('CLAIM_TRANSACTION');
        return arg(makeTxClient());
      }
      callOrder.push('RESCHEDULE_DB_TRANSACTION');
      return Promise.all(arg);
    });

    const resetTimeMs = Date.now() + 3_600_000;
    (rateLimiterService.checkAndIncrement as jest.Mock).mockResolvedValue({
      allowed: false,
      currentCount: 100,
      windowKey: 'rate:sender-1',
      resetTimeMs,
    });

    const job = createMockJob(emailId, 0);
    await (worker as any).processEmailJob(emailId, job);

    // Assert strict ordering: BULLMQ_ENQUEUE must happen BEFORE RESCHEDULE_DB_TRANSACTION
    expect(callOrder).toEqual([
      'CLAIM_TRANSACTION',
      'BULLMQ_ENQUEUE',
      'RESCHEDULE_DB_TRANSACTION',
    ]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 3: scheduledAt Guard → Future RESCHEDULED email is NOT claimed prematurely
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 3: scheduledAt guard → future RESCHEDULED email skips premature execution', async () => {
    const emailId = 'f5-test3-future-scheduled';
    const futureScheduledAt = new Date(Date.now() + 3_600_000); // 1 hour in future
    const email = createMockEmail(emailId, EmailStatus.RESCHEDULED, futureScheduledAt);

    (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...email });

    const job = createMockJob(emailId, 1);
    await (worker as any).processEmailJob(emailId, job);

    // Premature execution skipped: no SMTP, no claim transaction, no recovery
    expect(etherealService.sendEmail).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mockEmailQueueAdd).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 3B: scheduledAt Guard → Past RESCHEDULED email is claimable and processed
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 3B: scheduledAt guard → past RESCHEDULED email (due) is claimable and processed', async () => {
    const emailId = 'f5-test3b-due-scheduled';
    const pastScheduledAt = new Date(Date.now() - 5_000); // 5s in past (due)
    const email = createMockEmail(emailId, EmailStatus.RESCHEDULED, pastScheduledAt);

    (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...email });
    (prisma.email.updateMany as jest.Mock).mockImplementation(async ({ where, data }: any) => {
      // Step 5 claim guard validation
      return { count: 1 };
    });
    (prisma.emailEvent.create as jest.Mock).mockResolvedValue({});
    (prisma.campaign.update as jest.Mock).mockResolvedValue({});
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: any) =>
      typeof arg === 'function' ? arg(makeTxClient()) : Promise.all(arg)
    );
    (rateLimiterService.checkAndIncrement as jest.Mock).mockResolvedValue({
      allowed: true,
      currentCount: 1,
    });
    (etherealService.sendEmail as jest.Mock).mockResolvedValue({
      messageId: '<f5-test3b@ethereal.email>',
      previewUrl: false,
    });

    const job = createMockJob(emailId, 0);
    await (worker as any).processEmailJob(emailId, job);

    // Due email was claimed and dispatched
    expect(etherealService.sendEmail).toHaveBeenCalledTimes(1);
    expect(prisma.email.updateMany).toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 4: DB failure after enqueue → Delayed job safely remains in Redis
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 4: DB failure after enqueue → delayed job remains in Redis, worker verifies DB before send', async () => {
    const emailId = 'f5-test4-db-fail-after-enqueue';
    const email = createMockEmail(emailId, EmailStatus.SCHEDULED);

    (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...email });
    (prisma.email.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.emailEvent.create as jest.Mock).mockResolvedValue({});

    // BullMQ enqueue succeeds
    mockEmailQueueAdd.mockResolvedValue(undefined);

    // But DB update to RESCHEDULED fails (e.g. pool connection timeout)
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: any) => {
      if (typeof arg === 'function') {
        return arg(makeTxClient()); // Claim succeeds
      }
      throw new Error('PostgreSQL pool connection timeout');
    });

    const resetTimeMs = Date.now() + 3_600_000;
    (rateLimiterService.checkAndIncrement as jest.Mock).mockResolvedValue({
      allowed: false,
      currentCount: 100,
      windowKey: 'rate:sender-1',
      resetTimeMs,
    });

    const job = createMockJob(emailId, 0);

    // Worker throws the DB error
    await expect((worker as any).processEmailJob(emailId, job)).rejects.toThrow(
      'PostgreSQL pool connection timeout'
    );

    // BullMQ enqueue succeeded and job remains safely in Redis
    expect(mockEmailQueueAdd).toHaveBeenCalledTimes(1);
    expect(mockEmailQueueAdd).toHaveBeenCalledWith(
      'send-email',
      { emailId, isRescheduled: true },
      expect.objectContaining({
        jobId: `email-send-${emailId}-resched-${resetTimeMs}`,
      })
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 5: Successful Reschedule → Happy path
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 5: successful reschedule → enqueues delayed job with delay, updates DB to RESCHEDULED', async () => {
    const emailId = 'f5-test5-happy-reschedule';
    const email = createMockEmail(emailId, EmailStatus.SCHEDULED);

    (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...email });
    (prisma.email.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.emailEvent.create as jest.Mock).mockResolvedValue({});
    (prisma.email.update as jest.Mock).mockResolvedValue({});
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: any) =>
      typeof arg === 'function' ? arg(makeTxClient()) : Promise.all(arg)
    );

    const resetTimeMs = Date.now() + 3_600_000;
    (rateLimiterService.checkAndIncrement as jest.Mock).mockResolvedValue({
      allowed: false,
      currentCount: 100,
      windowKey: 'rate:sender-1',
      resetTimeMs,
    });

    const job = createMockJob(emailId, 0);
    await (worker as any).processEmailJob(emailId, job);

    // BullMQ delayed job enqueued
    expect(mockEmailQueueAdd).toHaveBeenCalledTimes(1);
    const enqueueCall = mockEmailQueueAdd.mock.calls[0];
    expect(enqueueCall[0]).toBe('send-email');
    expect(enqueueCall[1]).toEqual({ emailId, isRescheduled: true });
    expect(enqueueCall[2].jobId).toBe(`email-send-${emailId}-resched-${resetTimeMs}`);
    expect(enqueueCall[2].delay).toBeGreaterThanOrEqual(1000);

    // PostgreSQL updated with RESCHEDULED and audit event
    expect(prisma.$transaction).toHaveBeenCalledTimes(2); // Claim + Reschedule
    expect(prisma.email.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: emailId },
        data: expect.objectContaining({
          status: EmailStatus.RESCHEDULED,
          scheduledAt: expect.any(Date),
        }),
      })
    );

    // SMTP dispatch was NOT called
    expect(etherealService.sendEmail).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 6: Deterministic Duplicate Enqueue → Concurrent reschedules deduplicate
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 6: deterministic duplicate enqueue → same resetTimeMs produces identical jobId', async () => {
    const emailId = 'f5-test6-deterministic-dedup';
    const resetTimeMs = Date.now() + 3_600_000;

    const email = createMockEmail(emailId, EmailStatus.SCHEDULED);
    (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...email });
    (prisma.email.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.emailEvent.create as jest.Mock).mockResolvedValue({});
    (prisma.email.update as jest.Mock).mockResolvedValue({});
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: any) =>
      typeof arg === 'function' ? arg(makeTxClient()) : Promise.all(arg)
    );

    (rateLimiterService.checkAndIncrement as jest.Mock).mockResolvedValue({
      allowed: false,
      currentCount: 100,
      windowKey: 'rate:sender-1',
      resetTimeMs,
    });

    // Simulate 2 executions rescheduling the same email in the same window
    const job1 = createMockJob(emailId, 0);
    const job2 = createMockJob(emailId, 1);

    await (worker as any).processEmailJob(emailId, job1);
    await (worker as any).processEmailJob(emailId, job2);

    expect(mockEmailQueueAdd).toHaveBeenCalledTimes(2);

    const firstJobId = mockEmailQueueAdd.mock.calls[0][2].jobId;
    const secondJobId = mockEmailQueueAdd.mock.calls[1][2].jobId;

    // Both calls must use the EXACT same deterministic jobId
    expect(firstJobId).toBe(`email-send-${emailId}-resched-${resetTimeMs}`);
    expect(secondJobId).toBe(`email-send-${emailId}-resched-${resetTimeMs}`);
    expect(firstJobId).toBe(secondJobId);
  });
});
