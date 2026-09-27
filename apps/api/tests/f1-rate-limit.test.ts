/**
 * F1 Rate Limiter Quota Compensation Tests
 *
 * Verifies atomic quota compensation on SMTP delivery failure:
 * 1. rateLimiterService.compensate(senderId, windowKey) decrements with floor of 0.
 * 2. SMTP failure restores quota reservation before rethrowing to BullMQ.
 * 3. Retried email does not permanently burn multiple quota slots.
 * 4. Successful SMTP delivery does not compensate quota.
 * 5. Compensation never makes counter negative.
 * 6. Concurrent compensation calls remain safe.
 * 7. Existing dispatch receipt bypasses rate limit and never compensates.
 */

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
  eval: jest.fn(async (script: string, numkeys: number, key: string, ...args: string[]) => {
    if (script.includes('decr')) {
      // COMPENSATE_QUOTA_LUA: atomic decrement with floor of 0
      const current = parseInt(mockRedisStore.get(key) || '0', 10);
      if (current > 0) {
        const newVal = Math.max(0, current - 1);
        mockRedisStore.set(key, newVal.toString());
        return newVal;
      }
      return 0;
    }
    if (script.includes('incr')) {
      // CHECK_AND_INCR_LUA: atomic check and increment
      const limit = parseInt(args[0], 10);
      const current = parseInt(mockRedisStore.get(key) || '0', 10);
      if (current >= limit) {
        return [0, current];
      } else {
        const newVal = current + 1;
        mockRedisStore.set(key, newVal.toString());
        return [1, newVal];
      }
    }
    if (script.includes('scheduled_time')) {
      // RESERVE_SENDER_INTERVAL_LUA
      return Date.now();
    }
    return 0;
  }),
  quit: jest.fn().mockResolvedValue('OK'),
};

jest.mock('../src/queues/redis', () => ({
  redisConnectionOptions: {},
  redisClient: mockRedisClient,
}));

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

const mockEmailQueueAdd = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/queues/emailQueue', () => ({
  EMAIL_QUEUE_NAME: 'test-email-queue',
  emailQueue: { add: mockEmailQueueAdd },
  esIndexQueue: { add: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../src/services/ethereal', () => ({
  etherealService: {
    sendEmail: jest.fn(),
  },
}));

jest.mock('../src/services/slack', () => ({
  slackService: { sendDeduplicatedRateLimitAlert: jest.fn().mockResolvedValue(undefined) },
}));

import { EmailStatus, EventType } from '@reachflow/shared';
import { Job } from 'bullmq';
import { EmailJobData } from '../src/queues/emailQueue';
import { prisma } from '../src/prisma/client';
import { rateLimiterService, RateLimiterService } from '../src/services/rateLimiter';
import { etherealService } from '../src/services/ethereal';
import { EmailWorkerService } from '../src/workers/emailWorker';

describe('F1 — Rate Limiter Quota Compensation', () => {
  let worker: EmailWorkerService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisStore.clear();
    mockEmailQueueAdd.mockReset();
    mockEmailQueueAdd.mockResolvedValue(undefined);
    worker = new EmailWorkerService();
  });

  const createMockEmail = (options: {
    emailId: string;
    senderHourlyLimit?: number;
    campaignHourlyLimit?: number;
    status?: string;
  }) => ({
    id: options.emailId,
    status: options.status ?? EmailStatus.SCHEDULED,
    attempts: 0,
    scheduledAt: new Date(),
    senderId: 'sender-f1-test',
    sender: {
      id: 'sender-f1-test',
      email: 'f1-sender@reachflow.io',
      name: 'F1 Sender',
      hourlyLimit: options.senderHourlyLimit ?? 50,
      etherealUser: 'ethereal_user',
      etherealPass: 'ethereal_pass',
    },
    campaignId: 'camp-f1-test',
    campaign: {
      id: 'camp-f1-test',
      name: 'F1 Campaign',
      delayMs: 1,
      hourlyLimit: options.campaignHourlyLimit ?? 50,
    },
    userId: 'user-f1',
    user: {},
    recipient: 'recipient@domain.com',
    subject: 'F1 Test Email',
    body: 'Testing quota compensation.',
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
  // TEST 1: compensation never makes counter negative
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 1: compensation never makes counter negative', async () => {
    const senderId = 'sender-neg-test';
    const { windowKey } = RateLimiterService.getHourlyWindowKey();
    const redisKey = `reachflow:ratelimit:sender:${senderId}:window:${windowKey}`;

    // 1. Initial state: key does not exist. Compensating must return 0, not negative.
    const res1 = await rateLimiterService.compensate(senderId, windowKey);
    expect(res1).toBe(0);
    expect(mockRedisStore.get(redisKey)).toBeUndefined();

    // 2. Set key to 0 explicitly. Compensating must return 0 and keep 0.
    mockRedisStore.set(redisKey, '0');
    const res2 = await rateLimiterService.compensate(senderId, windowKey);
    expect(res2).toBe(0);
    expect(mockRedisStore.get(redisKey)).toBe('0');

    // 3. Set key to 1. Compensating decrements to 0.
    mockRedisStore.set(redisKey, '1');
    const res3 = await rateLimiterService.compensate(senderId, windowKey);
    expect(res3).toBe(0);
    expect(mockRedisStore.get(redisKey)).toBe('0');

    // 4. Repeated compensation continues to clamp at 0.
    const res4 = await rateLimiterService.compensate(senderId, windowKey);
    expect(res4).toBe(0);
    expect(mockRedisStore.get(redisKey)).toBe('0');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 2: concurrent compensation remains safe
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 2: concurrent compensation remains safe and bounded at 0', async () => {
    const senderId = 'sender-concurrent-test';
    const { windowKey } = RateLimiterService.getHourlyWindowKey();
    const redisKey = `reachflow:ratelimit:sender:${senderId}:window:${windowKey}`;

    // Start with 5 units of quota consumed
    mockRedisStore.set(redisKey, '5');

    // 10 concurrent compensation calls (more calls than quota)
    const results = await Promise.all(
      Array.from({ length: 10 }, () => rateLimiterService.compensate(senderId, windowKey))
    );

    // Final value in Redis must be strictly 0, never negative
    expect(mockRedisStore.get(redisKey)).toBe('0');

    // Every returned value must be >= 0
    for (const val of results) {
      expect(val).toBeGreaterThanOrEqual(0);
    }

    // Usage check returns 0
    const usage = await rateLimiterService.getCurrentUsage(senderId);
    expect(usage).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 3: SMTP failure restores quota
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 3: SMTP failure restores quota reservation before rethrowing to BullMQ', async () => {
    const emailId = 'email-f1-smtp-fail';
    const email = createMockEmail({ emailId });
    const { windowKey } = RateLimiterService.getHourlyWindowKey();
    const redisKey = `reachflow:ratelimit:sender:${email.senderId}:window:${windowKey}`;

    (prisma.email.findUnique as jest.Mock).mockResolvedValue(email);
    (prisma.email.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.emailEvent.create as jest.Mock).mockResolvedValue({});
    (prisma.email.update as jest.Mock).mockResolvedValue({});
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: any) =>
      typeof arg === 'function' ? arg(makeTxClient()) : Promise.all(arg)
    );

    // SMTP throws network error
    (etherealService.sendEmail as jest.Mock).mockRejectedValue(new Error('SMTP Connection Refused (ECONNREFUSED)'));

    const compensateSpy = jest.spyOn(rateLimiterService, 'compensate');
    const job = createMockJob(emailId, 0);

    // Worker must throw to trigger BullMQ exponential backoff
    await expect((worker as any).processEmailJob(emailId, job)).rejects.toThrow('SMTP Connection Refused');

    // 1. Quota compensation was called with exact senderId and windowKey
    expect(compensateSpy).toHaveBeenCalledTimes(1);
    expect(compensateSpy).toHaveBeenCalledWith(email.senderId, windowKey);

    // 2. Redis quota counter was restored back to 0
    expect(mockRedisStore.get(redisKey)).toBe('0');

    // 3. Email was marked SCHEDULED for retry (not FAILED yet since attempt 0 < 2)
    expect(prisma.email.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: emailId },
        data: expect.objectContaining({
          status: EmailStatus.SCHEDULED,
          error: 'SMTP Connection Refused (ECONNREFUSED)',
        }),
      })
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 4: retry does not permanently burn quota
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 4: retry does not permanently burn quota (1 successful send = 1 quota consumed)', async () => {
    const emailId = 'email-f1-retry-quota';
    const email = createMockEmail({ emailId });
    const { windowKey } = RateLimiterService.getHourlyWindowKey();
    const redisKey = `reachflow:ratelimit:sender:${email.senderId}:window:${windowKey}`;

    (prisma.email.findUnique as jest.Mock).mockResolvedValue(email);
    (prisma.email.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.emailEvent.create as jest.Mock).mockResolvedValue({});
    (prisma.email.update as jest.Mock).mockResolvedValue({});
    (prisma.campaign.update as jest.Mock).mockResolvedValue({});
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: any) =>
      typeof arg === 'function' ? arg(makeTxClient()) : Promise.all(arg)
    );

    const compensateSpy = jest.spyOn(rateLimiterService, 'compensate');

    // ATTEMPT 1: SMTP fails
    (etherealService.sendEmail as jest.Mock).mockRejectedValueOnce(new Error('Transient 503 Service Unavailable'));
    const jobAttempt1 = createMockJob(emailId, 0);

    await expect((worker as any).processEmailJob(emailId, jobAttempt1)).rejects.toThrow('Transient 503');

    // Quota was restored after attempt 1 failure
    expect(compensateSpy).toHaveBeenCalledTimes(1);
    expect(mockRedisStore.get(redisKey)).toBe('0');

    // ATTEMPT 2 (Retry): SMTP succeeds
    (etherealService.sendEmail as jest.Mock).mockResolvedValueOnce({
      messageId: '<retry-success@reachflow.io>',
      response: '250 OK: queued as 9999',
      accepted: ['recipient@domain.com'],
      rejected: [],
    });
    const jobAttempt2 = createMockJob(emailId, 1);

    await (worker as any).processEmailJob(emailId, jobAttempt2);

    // Compensate was NOT called on attempt 2
    expect(compensateSpy).toHaveBeenCalledTimes(1);

    // Final quota in Redis is exactly 1 (not 2!)
    expect(mockRedisStore.get(redisKey)).toBe('1');

    // Final email status is SENT (committed via updateMany in finalizeSentStatus)
    expect(prisma.email.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: emailId, status: { not: EmailStatus.SENT } },
        data: expect.objectContaining({
          status: EmailStatus.SENT,
          messageId: '<retry-success@reachflow.io>',
        }),
      })
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 5: successful SMTP does not compensate
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 5: successful SMTP does not compensate quota', async () => {
    const emailId = 'email-f1-smtp-success';
    const email = createMockEmail({ emailId });
    const { windowKey } = RateLimiterService.getHourlyWindowKey();
    const redisKey = `reachflow:ratelimit:sender:${email.senderId}:window:${windowKey}`;

    (prisma.email.findUnique as jest.Mock).mockResolvedValue(email);
    (prisma.email.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.emailEvent.create as jest.Mock).mockResolvedValue({});
    (prisma.email.update as jest.Mock).mockResolvedValue({});
    (prisma.campaign.update as jest.Mock).mockResolvedValue({});
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: any) =>
      typeof arg === 'function' ? arg(makeTxClient()) : Promise.all(arg)
    );

    (etherealService.sendEmail as jest.Mock).mockResolvedValue({
      messageId: '<success-msg@reachflow.io>',
      response: '250 OK',
      accepted: ['recipient@domain.com'],
      rejected: [],
    });

    const compensateSpy = jest.spyOn(rateLimiterService, 'compensate');
    const job = createMockJob(emailId, 0);

    await (worker as any).processEmailJob(emailId, job);

    // Compensate was NEVER called
    expect(compensateSpy).not.toHaveBeenCalled();

    // Quota remains 1 in Redis
    expect(mockRedisStore.get(redisKey)).toBe('1');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 6: existing dispatch receipt bypasses rate limit and never compensates
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 6: existing dispatch receipt bypasses rate limiting and does not compensate', async () => {
    const emailId = 'email-f1-existing-receipt';
    const email = createMockEmail({ emailId, status: EmailStatus.PROCESSING });

    // Store existing receipt in Redis with the exact prefix 'reachflow:dispatch_receipt:'
    const receiptKey = `reachflow:dispatch_receipt:${emailId}`;
    mockRedisStore.set(
      receiptKey,
      JSON.stringify({
        messageId: '<prior-accepted@reachflow.io>',
        sentAt: new Date().toISOString(),
      })
    );

    (prisma.email.findUnique as jest.Mock).mockResolvedValue(email);
    (prisma.email.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.campaign.update as jest.Mock).mockResolvedValue({});
    (prisma.emailEvent.create as jest.Mock).mockResolvedValue({});
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: any) =>
      typeof arg === 'function' ? arg(makeTxClient()) : Promise.all(arg)
    );

    const compensateSpy = jest.spyOn(rateLimiterService, 'compensate');
    const checkSpy = jest.spyOn(rateLimiterService, 'checkAndIncrement');
    const job = createMockJob(emailId, 1);

    await (worker as any).processEmailJob(emailId, job);

    // Neither checkAndIncrement nor compensate were called
    expect(checkSpy).not.toHaveBeenCalled();
    expect(compensateSpy).not.toHaveBeenCalled();
    expect(etherealService.sendEmail).not.toHaveBeenCalled();

    // Finalized as SENT using prior receipt via updateMany
    expect(prisma.email.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: emailId, status: { not: EmailStatus.SENT } },
        data: expect.objectContaining({
          status: EmailStatus.SENT,
          messageId: '<prior-accepted@reachflow.io>',
        }),
      })
    );
  });
});
