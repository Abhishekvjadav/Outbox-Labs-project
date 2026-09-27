/**
 * F3 Recovery Tests
 *
 * Validates the deterministic delayed-recovery mechanism that prevents
 * PROCESSING emails from being permanently stranded when BullMQ retries
 * are consumed during an active processing lease.
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

// In-memory Redis store mock
const redisStore = new Map<string, string>();
const mockRedisClient = {
  get: jest.fn(async (key: string) => redisStore.get(key) || null),
  set: jest.fn(async (key: string, value: string, _ex?: string, _ttl?: number, mode?: string) => {
    if (mode === 'NX' && redisStore.has(key)) {
      return null;
    }
    redisStore.set(key, value);
    return 'OK';
  }),
  del: jest.fn(async (key: string) => {
    const deleted = redisStore.delete(key);
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
    checkAndIncrement: jest.fn().mockResolvedValue({ allowed: true, currentCount: 1 }),
    reserveSendSlot: jest.fn().mockResolvedValue(Date.now()),
  },
}));

jest.mock('../src/services/ethereal', () => ({
  etherealService: { sendEmail: jest.fn() },
}));

jest.mock('../src/services/slack', () => ({
  slackService: { sendDeduplicatedRateLimitAlert: jest.fn() },
}));

import { EmailStatus, EventType } from '@reachflow/shared';
import { Job } from 'bullmq';
import { EmailJobData } from '../src/queues/emailQueue';
import { prisma } from '../src/prisma/client';
import { etherealService } from '../src/services/ethereal';
import { EmailWorkerService, DispatchReceipt } from '../src/workers/emailWorker';

describe('F3 — Deterministic Delayed Recovery for Stranded PROCESSING Emails', () => {
  let worker: EmailWorkerService;

  beforeEach(() => {
    jest.clearAllMocks();
    redisStore.clear();
    mockEmailQueueAdd.mockResolvedValue(undefined);
    worker = new EmailWorkerService();
  });

  const createMockEmail = (emailId: string, status: string = EmailStatus.SCHEDULED) => ({
    id: emailId,
    status,
    attempts: 0,
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
    recipient: 'prospect@client.com',
    subject: 'Partnership Inquiry',
    body: 'Hello Prospect, let us connect.',
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
    email: { updateMany: prisma.email.updateMany },
    campaign: { update: prisma.campaign.update },
    emailEvent: { create: prisma.emailEvent.create },
  });

  // ───────────────────────────────────────────────────────────────────────
  // TEST 1: PROCESSING + active lease → no SMTP, not FAILED, recovery exists
  // ───────────────────────────────────────────────────────────────────────
  it('TEST 1: PROCESSING + active lease → no SMTP, no FAILED, schedules deterministic recovery job', async () => {
    const emailId = 'f3-test1-active-lease-recovery';
    const leaseAge = 10_000; // 10s into 60s lease
    const email = {
      ...createMockEmail(emailId, EmailStatus.PROCESSING),
      attempts: 1,
      updatedAt: new Date(Date.now() - leaseAge),
    };

    (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...email });

    const job = createMockJob(emailId, 1);
    await (worker as any).processEmailJob(emailId, job);

    // NO SMTP called
    expect(etherealService.sendEmail).not.toHaveBeenCalled();

    // NO status change (not FAILED, not SENT)
    expect(prisma.email.updateMany).not.toHaveBeenCalled();

    // Recovery job WAS scheduled with generation 0 and attempt 1
    expect(mockEmailQueueAdd).toHaveBeenCalledTimes(1);
    expect(mockEmailQueueAdd).toHaveBeenCalledWith(
      'send-email',
      { emailId, isRecovery: true, recoveryGeneration: 0 },
      expect.objectContaining({
        jobId: `email-recovery-${emailId}-${email.attempts}-0`,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      })
    );

    // Verify delay is approximately correct (lease remaining + buffer)
    const addCallArgs = mockEmailQueueAdd.mock.calls[0][2];
    const expectedMinDelay = EmailWorkerService.LEASE_TIMEOUT_MS - leaseAge + EmailWorkerService.RECOVERY_BUFFER_MS - 100; // tolerance
    const expectedMaxDelay = EmailWorkerService.LEASE_TIMEOUT_MS - leaseAge + EmailWorkerService.RECOVERY_BUFFER_MS + 100; // tolerance
    expect(addCallArgs.delay).toBeGreaterThanOrEqual(expectedMinDelay);
    expect(addCallArgs.delay).toBeLessThanOrEqual(expectedMaxDelay);
  });

  // ───────────────────────────────────────────────────────────────────────
  // TEST 2: PROCESSING + expired lease + no receipt → conservative FAILED/DLQ
  // ───────────────────────────────────────────────────────────────────────
  it('TEST 2: PROCESSING + expired lease + no receipt → FAILED/DLQ, no blind SMTP resend', async () => {
    const emailId = 'f3-test2-expired-lease-no-receipt';
    const email = {
      ...createMockEmail(emailId, EmailStatus.PROCESSING),
      attempts: 1,
      updatedAt: new Date(Date.now() - (EmailWorkerService.LEASE_TIMEOUT_MS + 30_000)),
    };

    let emailStatus = EmailStatus.PROCESSING;
    let dlqEventCreated = false;

    (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...email });
    (prisma.email.updateMany as jest.Mock).mockImplementation(async ({ where, data }: any) => {
      if (where.status === EmailStatus.PROCESSING && where.attempts === email.attempts) {
        emailStatus = data.status;
        return { count: 1 };
      }
      return { count: 0 };
    });
    (prisma.emailEvent.create as jest.Mock).mockImplementation(async ({ data }: any) => {
      if (data.type === EventType.DLQ_MOVED) dlqEventCreated = true;
      return {};
    });
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: any) =>
      typeof arg === 'function' ? arg(makeTxClient()) : Promise.all(arg)
    );

    const job = createMockJob(emailId, 1);
    await (worker as any).processEmailJob(emailId, job);

    // SMTP was NOT called
    expect(etherealService.sendEmail).not.toHaveBeenCalled();

    // Conservatively moved to FAILED/DLQ
    expect(emailStatus).toBe(EmailStatus.FAILED);
    expect(dlqEventCreated).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────
  // TEST 3: PROCESSING + dispatch receipt → SENT, zero SMTP calls
  // ───────────────────────────────────────────────────────────────────────
  it('TEST 3: PROCESSING + dispatch receipt → finalized as SENT, zero SMTP calls', async () => {
    const emailId = 'f3-test3-receipt-finalization';
    const email = createMockEmail(emailId, EmailStatus.PROCESSING);

    // Pre-populate receipt in Redis
    const receipt: DispatchReceipt = {
      messageId: '<f3-receipt-test@ethereal.email>',
      previewUrl: 'https://ethereal.email/message/f3-test',
      sentAt: new Date().toISOString(),
    };
    redisStore.set(`reachflow:dispatch_receipt:${emailId}`, JSON.stringify(receipt));

    let emailStatus = EmailStatus.PROCESSING;

    (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...email });
    (prisma.email.updateMany as jest.Mock).mockImplementation(async ({ where, data }: any) => {
      if (where.status?.not && emailStatus === where.status.not) {
        return { count: 0 };
      }
      emailStatus = data.status;
      return { count: 1 };
    });
    (prisma.campaign.update as jest.Mock).mockResolvedValue({});
    (prisma.emailEvent.create as jest.Mock).mockResolvedValue({});
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: any) =>
      typeof arg === 'function' ? arg(makeTxClient()) : Promise.all(arg)
    );

    const job = createMockJob(emailId, 1);
    await (worker as any).processEmailJob(emailId, job);

    // SMTP was NOT called
    expect(etherealService.sendEmail).not.toHaveBeenCalled();

    // Finalized as SENT using receipt
    expect(emailStatus).toBe(EmailStatus.SENT);

    // Receipt-based finalization used the correct messageId
    expect(prisma.email.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: emailId,
          status: { not: EmailStatus.SENT },
        }),
        data: expect.objectContaining({
          status: EmailStatus.SENT,
          messageId: receipt.messageId,
        }),
      })
    );
  });

  // ───────────────────────────────────────────────────────────────────────
  // TEST 4: Infrastructure failure after PROCESSING → email cannot strand
  //
  // Full lifecycle: claim → PROCESSING → infra failure → BullMQ retry
  // with active lease → skip + schedule recovery → recovery fires after
  // lease expiry → FAILED/DLQ (conservative, since no receipt).
  // ───────────────────────────────────────────────────────────────────────
  it('TEST 4: infra failure after PROCESSING → recovery job scheduled → email not permanently stranded', async () => {
    const emailId = 'f3-test4-stranding-prevention';

    // Phase 1: Initial execution claims email, then infra error before SMTP.
    // After error, BullMQ retries immediately. Email is PROCESSING + active lease.
    const email = {
      ...createMockEmail(emailId, EmailStatus.PROCESSING),
      attempts: 1,
      updatedAt: new Date(Date.now() - 5_000), // 5s old lease — active
    };

    (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...email });

    // Phase 1: BullMQ retry hits active lease
    const retryJob = createMockJob(emailId, 1);
    await (worker as any).processEmailJob(emailId, retryJob);

    // Verify: no SMTP, no status change, but recovery job exists
    expect(etherealService.sendEmail).not.toHaveBeenCalled();
    expect(prisma.email.updateMany).not.toHaveBeenCalled();
    expect(mockEmailQueueAdd).toHaveBeenCalledTimes(1);
    expect(mockEmailQueueAdd).toHaveBeenCalledWith(
      'send-email',
      { emailId, isRecovery: true, recoveryGeneration: 0 },
      expect.objectContaining({
        jobId: `email-recovery-${emailId}-${email.attempts}-0`,
      })
    );

    // The delay should ensure it fires AFTER the lease expires
    const scheduledDelay = mockEmailQueueAdd.mock.calls[0][2].delay;
    expect(scheduledDelay).toBeGreaterThan(EmailWorkerService.RECOVERY_BUFFER_MS);
    // delay = (60000 - 5000) + 5000 = 60000ms approximately
    expect(scheduledDelay).toBeLessThanOrEqual(
      EmailWorkerService.LEASE_TIMEOUT_MS + EmailWorkerService.RECOVERY_BUFFER_MS
    );

    // Phase 2: Simulate recovery job execution after lease expires.
    // Now email has an expired lease, no receipt → conservative FAILED/DLQ.
    jest.clearAllMocks();
    redisStore.clear();

    const expiredEmail = {
      ...createMockEmail(emailId, EmailStatus.PROCESSING),
      attempts: 1,
      updatedAt: new Date(Date.now() - (EmailWorkerService.LEASE_TIMEOUT_MS + 10_000)),
    };

    let finalStatus = EmailStatus.PROCESSING;
    let dlqEventCreated = false;

    (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...expiredEmail });
    (prisma.email.updateMany as jest.Mock).mockImplementation(async ({ where, data }: any) => {
      if (where.status === EmailStatus.PROCESSING && where.attempts === expiredEmail.attempts) {
        finalStatus = data.status;
        return { count: 1 };
      }
      return { count: 0 };
    });
    (prisma.emailEvent.create as jest.Mock).mockImplementation(async ({ data }: any) => {
      if (data.type === EventType.DLQ_MOVED) dlqEventCreated = true;
      return {};
    });
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: any) =>
      typeof arg === 'function' ? arg(makeTxClient()) : Promise.all(arg)
    );

    const recoveryJob = createMockJob(emailId, 0);
    await (worker as any).processEmailJob(emailId, recoveryJob);

    // Recovery executed the expired-lease path
    expect(finalStatus).toBe(EmailStatus.FAILED);
    expect(dlqEventCreated).toBe(true);
    expect(etherealService.sendEmail).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────────────────────────────
  // TEST 5: Duplicate recovery scheduling → idempotent (no duplicate jobs)
  // ───────────────────────────────────────────────────────────────────────
  it('TEST 5: multiple active-lease encounters → deterministic jobId → no duplicate executable work', async () => {
    const emailId = 'f3-test5-idempotent-recovery';
    const email = {
      ...createMockEmail(emailId, EmailStatus.PROCESSING),
      attempts: 1,
      updatedAt: new Date(Date.now() - 15_000), // 15s old lease — active
    };

    (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...email });

    // Simulate 3 separate BullMQ retries all hitting the active lease
    const job1 = createMockJob(emailId, 1);
    const job2 = createMockJob(emailId, 2);
    const job3 = createMockJob(emailId, 3);

    await (worker as any).processEmailJob(emailId, job1);
    await (worker as any).processEmailJob(emailId, job2);
    await (worker as any).processEmailJob(emailId, job3);

    // emailQueue.add was called 3 times, but all with the SAME deterministic jobId
    expect(mockEmailQueueAdd).toHaveBeenCalledTimes(3);
    const allJobIds = mockEmailQueueAdd.mock.calls.map((call: any[]) => call[2].jobId);
    const uniqueJobIds = new Set(allJobIds);
    expect(uniqueJobIds.size).toBe(1);
    expect(allJobIds[0]).toBe(`email-recovery-${emailId}-${email.attempts}-0`);

    // BullMQ deduplication guarantees: same jobId = only one executable job.
    // This test verifies we always use the same jobId, delegating dedup to BullMQ.
  });

  // ───────────────────────────────────────────────────────────────────────
  // TEST 6: Original worker succeeds → recovery job sees SENT → safe no-op
  // ───────────────────────────────────────────────────────────────────────
  it('TEST 6: original worker succeeds before recovery → recovery sees SENT, exits safely', async () => {
    const emailId = 'f3-test6-original-succeeds';

    // Recovery job fires, but email is already SENT
    const email = createMockEmail(emailId, EmailStatus.SENT);

    (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...email });

    const recoveryJob = createMockJob(emailId, 0);
    await (worker as any).processEmailJob(emailId, recoveryJob);

    // Existing idempotency: SENT → return immediately, no SMTP, no DB writes
    expect(etherealService.sendEmail).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.email.updateMany).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────────────────────────────
  // TEST 7: Original worker succeeds with receipt → recovery sees receipt → finalize, no SMTP
  // ───────────────────────────────────────────────────────────────────────
  it('TEST 7: recovery sees dispatch receipt after original SMTP → finalizes without SMTP', async () => {
    const emailId = 'f3-test7-recovery-with-receipt';
    const email = {
      ...createMockEmail(emailId, EmailStatus.PROCESSING),
      attempts: 1,
      updatedAt: new Date(Date.now() - (EmailWorkerService.LEASE_TIMEOUT_MS + 10_000)),
    };

    // Original worker succeeded SMTP and wrote a receipt, but DB finalization failed
    const receipt: DispatchReceipt = {
      messageId: '<f3-recovery-receipt@ethereal.email>',
      previewUrl: false,
      sentAt: new Date().toISOString(),
    };
    redisStore.set(`reachflow:dispatch_receipt:${emailId}`, JSON.stringify(receipt));

    let emailStatus = EmailStatus.PROCESSING;

    (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...email });
    (prisma.email.updateMany as jest.Mock).mockImplementation(async ({ where, data }: any) => {
      if (where.status?.not && emailStatus === where.status.not) {
        return { count: 0 };
      }
      emailStatus = data.status;
      return { count: 1 };
    });
    (prisma.campaign.update as jest.Mock).mockResolvedValue({});
    (prisma.emailEvent.create as jest.Mock).mockResolvedValue({});
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: any) =>
      typeof arg === 'function' ? arg(makeTxClient()) : Promise.all(arg)
    );

    const recoveryJob = createMockJob(emailId, 0);
    await (worker as any).processEmailJob(emailId, recoveryJob);

    // SMTP was NOT called — receipt-based finalization only
    expect(etherealService.sendEmail).not.toHaveBeenCalled();
    expect(emailStatus).toBe(EmailStatus.SENT);
  });

  // ───────────────────────────────────────────────────────────────────────
  // TEST 8: Recovery scheduling failure is non-fatal (does not throw)
  // ───────────────────────────────────────────────────────────────────────
  it('TEST 8: recovery job scheduling failure is non-fatal — does not throw or alter state', async () => {
    const emailId = 'f3-test8-recovery-schedule-failure';
    const email = {
      ...createMockEmail(emailId, EmailStatus.PROCESSING),
      attempts: 1,
      updatedAt: new Date(Date.now() - 5_000), // active lease
    };

    (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...email });

    // Make emailQueue.add fail
    mockEmailQueueAdd.mockRejectedValueOnce(new Error('Redis connection refused'));

    const job = createMockJob(emailId, 1);

    // Should NOT throw — the error is caught and logged
    await expect(
      (worker as any).processEmailJob(emailId, job)
    ).resolves.toBeUndefined();

    // SMTP was NOT called
    expect(etherealService.sendEmail).not.toHaveBeenCalled();

    // emailQueue.add was attempted but failed
    expect(mockEmailQueueAdd).toHaveBeenCalledTimes(1);
  });

  // ───────────────────────────────────────────────────────────────────────
  // TEST 9: Multi-generation recovery: Gen 0 active lease → schedules Gen 1 without collision
  // ───────────────────────────────────────────────────────────────────────
  it('TEST 9: recovery job Gen 0 encounters active lease → schedules Gen 1 with distinct jobId (no self-collision)', async () => {
    const emailId = 'f3-test9-multi-gen-scheduling';
    const email = {
      ...createMockEmail(emailId, EmailStatus.PROCESSING),
      attempts: 1,
      updatedAt: new Date(Date.now() - 10_000), // active lease (10s old)
    };

    (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...email });

    // Active recovery job for Generation 0
    const recoveryJobGen0 = {
      id: `email-recovery-${emailId}-1-0`,
      data: { emailId, isRecovery: true, recoveryGeneration: 0 },
      opts: { attempts: 1 },
      attemptsMade: 0,
    } as Job<EmailJobData>;

    await (worker as any).processEmailJob(emailId, recoveryJobGen0);

    // Gen 0 must schedule Generation 1
    expect(mockEmailQueueAdd).toHaveBeenCalledTimes(1);
    expect(mockEmailQueueAdd).toHaveBeenCalledWith(
      'send-email',
      {
        emailId,
        isRecovery: true,
        recoveryGeneration: 1,
      },
      expect.objectContaining({
        jobId: `email-recovery-${emailId}-${email.attempts}-1`,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      })
    );

    // Verify distinct jobId: does NOT collide with Gen 0's jobId
    const scheduledJobId = mockEmailQueueAdd.mock.calls[0][2].jobId;
    expect(scheduledJobId).toBe(`email-recovery-${emailId}-1-1`);
    expect(scheduledJobId).not.toBe(recoveryJobGen0.id);
  });

  // ───────────────────────────────────────────────────────────────────────
  // TEST 10: Multi-generation crash scenario: Gen 0 → Gen 1 → crash → Gen 1 recovers
  // ───────────────────────────────────────────────────────────────────────
  it('TEST 10: worker crashes after Gen 0 schedules Gen 1 → Gen 1 fires on expired lease → moves to DLQ', async () => {
    const emailId = 'f3-test10-crash-recovery-chain';

    // Step 1: Gen 0 fires while original worker is still alive (lease active due to heartbeat)
    const emailWhileAlive = {
      ...createMockEmail(emailId, EmailStatus.PROCESSING),
      attempts: 1,
      updatedAt: new Date(Date.now() - 5_000), // fresh heartbeat 5s ago
    };
    (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...emailWhileAlive });

    const recoveryJobGen0 = {
      id: `email-recovery-${emailId}-1-0`,
      data: { emailId, isRecovery: true, recoveryGeneration: 0 },
      opts: { attempts: 1 },
      attemptsMade: 0,
    } as Job<EmailJobData>;

    await (worker as any).processEmailJob(emailId, recoveryJobGen0);

    // Gen 1 scheduled
    expect(mockEmailQueueAdd).toHaveBeenCalledWith(
      'send-email',
      { emailId, isRecovery: true, recoveryGeneration: 1 },
      expect.objectContaining({
        jobId: `email-recovery-${emailId}-1-1`,
      })
    );

    // Step 2: 10s later, original worker crashes. Heartbeats cease.
    // 65s later, Gen 1 fires. Lease is now expired.
    jest.clearAllMocks();
    redisStore.clear();

    const emailAfterCrash = {
      ...createMockEmail(emailId, EmailStatus.PROCESSING),
      attempts: 1,
      updatedAt: new Date(Date.now() - (EmailWorkerService.LEASE_TIMEOUT_MS + 5_000)), // expired!
    };
    let emailStatus = EmailStatus.PROCESSING;
    let dlqEventCreated = false;

    (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...emailAfterCrash });
    (prisma.email.updateMany as jest.Mock).mockImplementation(async ({ where, data }: any) => {
      if (where.status === EmailStatus.PROCESSING && where.attempts === emailAfterCrash.attempts) {
        emailStatus = data.status;
        return { count: 1 };
      }
      return { count: 0 };
    });
    (prisma.emailEvent.create as jest.Mock).mockImplementation(async ({ data }: any) => {
      if (data.type === EventType.DLQ_MOVED) dlqEventCreated = true;
      return {};
    });
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: any) =>
      typeof arg === 'function' ? arg(makeTxClient()) : Promise.all(arg)
    );

    const recoveryJobGen1 = {
      id: `email-recovery-${emailId}-1-1`,
      data: { emailId, isRecovery: true, recoveryGeneration: 1 },
      opts: { attempts: 1 },
      attemptsMade: 0,
    } as Job<EmailJobData>;

    await (worker as any).processEmailJob(emailId, recoveryJobGen1);

    // Email was successfully recovered and transitioned to DLQ
    expect(emailStatus).toBe(EmailStatus.FAILED);
    expect(dlqEventCreated).toBe(true);
    expect(etherealService.sendEmail).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────────────────────────────
  // TEST 11: Slow SMTP scenario: Gen 1 fires after successful send → safe no-op
  // ───────────────────────────────────────────────────────────────────────
  it('TEST 11: slow SMTP finishes before Gen 1 fires → Gen 1 sees SENT → safe no-op', async () => {
    const emailId = 'f3-test11-slow-smtp-safe-exit';

    // Worker took long, Gen 0 scheduled Gen 1, but worker finished and status is now SENT
    const emailSent = createMockEmail(emailId, EmailStatus.SENT);
    (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...emailSent });

    const recoveryJobGen1 = {
      id: `email-recovery-${emailId}-1-1`,
      data: { emailId, isRecovery: true, recoveryGeneration: 1 },
      opts: { attempts: 1 },
      attemptsMade: 0,
    } as Job<EmailJobData>;

    await (worker as any).processEmailJob(emailId, recoveryJobGen1);

    // Safe exit: no SMTP, no DB updates, no new recovery jobs scheduled
    expect(etherealService.sendEmail).not.toHaveBeenCalled();
    expect(prisma.email.updateMany).not.toHaveBeenCalled();
    expect(mockEmailQueueAdd).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────────────────────────────
  // TEST 12: Scoped heartbeat clears upon completion
  // ───────────────────────────────────────────────────────────────────────
  it('TEST 12: worker processing starts scoped heartbeat and cleans up timer on completion', async () => {
    const emailId = 'f3-test12-heartbeat-cleanup';
    const email = createMockEmail(emailId, EmailStatus.SCHEDULED);

    (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...email });
    (prisma.email.updateMany as jest.Mock).mockImplementation(async ({ where, data }: any) => {
      return { count: 1 };
    });
    (prisma.campaign.update as jest.Mock).mockResolvedValue({});
    (prisma.emailEvent.create as jest.Mock).mockResolvedValue({});
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: any) =>
      typeof arg === 'function' ? arg(makeTxClient()) : Promise.all(arg)
    );
    (etherealService.sendEmail as jest.Mock).mockResolvedValue({
      messageId: '<test-heartbeat@ethereal.email>',
      previewUrl: false,
    });

    const job = createMockJob(emailId, 0);

    // Spy on setInterval and clearInterval
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

    await (worker as any).processEmailJob(emailId, job);

    // Heartbeat was started with 15s interval
    expect(setIntervalSpy).toHaveBeenCalledWith(
      expect.any(Function),
      EmailWorkerService.HEARTBEAT_INTERVAL_MS
    );

    // Heartbeat was cleared in finally block when processing completed
    expect(clearIntervalSpy).toHaveBeenCalled();

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  // ───────────────────────────────────────────────────────────────────────
  // TEST 13: Missing or invalid updatedAt in mock → safe finite delay (never NaN)
  // ───────────────────────────────────────────────────────────────────────
  it('TEST 13: missing or invalid updatedAt in mock → calculates safe finite delay, never NaN', async () => {
    const emailId = 'f3-test13-invalid-updated-at';
    const email = {
      ...createMockEmail(emailId, EmailStatus.PROCESSING),
      attempts: 1,
      updatedAt: undefined as any, // Missing / invalid updatedAt
    };

    (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...email });

    const job = createMockJob(emailId, 1);
    await (worker as any).processEmailJob(emailId, job);

    expect(mockEmailQueueAdd).toHaveBeenCalledTimes(1);
    const delayArg = mockEmailQueueAdd.mock.calls[0][2].delay;
    expect(Number.isFinite(delayArg)).toBe(true);
    expect(Number.isNaN(delayArg)).toBe(false);
    expect(delayArg).toBe(EmailWorkerService.LEASE_TIMEOUT_MS + EmailWorkerService.RECOVERY_BUFFER_MS);
  });
});
