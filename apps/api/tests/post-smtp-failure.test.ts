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

jest.mock('../src/queues/emailQueue', () => ({
  EMAIL_QUEUE_NAME: 'test-email-queue',
  emailQueue: { add: jest.fn() },
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

import { EmailStatus } from '@reachflow/shared';
import { Job } from 'bullmq';
import { EmailJobData } from '../src/queues/emailQueue';
import { prisma } from '../src/prisma/client';
import { etherealService } from '../src/services/ethereal';
import { EmailWorkerService, DispatchReceipt } from '../src/workers/emailWorker';

describe('Post-SMTP / Database Failure Safety', () => {
  let worker: EmailWorkerService;

  beforeEach(() => {
    jest.clearAllMocks();
    redisStore.clear();
    worker = new EmailWorkerService();
  });

  const createMockEmail = (emailId: string, status: EmailStatus = EmailStatus.SCHEDULED) => ({
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
  });

  const createMockJob = (emailId: string, attemptsMade: number = 0) =>
    ({
      id: `email-send-${emailId}`,
      data: { emailId },
      opts: { attempts: 3 },
      attemptsMade,
    } as Job<EmailJobData>);

  /**
   * TEST 1 — CORE TEST
   * "does not send duplicate email when PostgreSQL finalization fails after SMTP succeeds"
   */
  it('does not send duplicate email when PostgreSQL finalization fails after SMTP succeeds', async () => {
    const emailId = 'email-core-failure-test';
    const email = createMockEmail(emailId, EmailStatus.SCHEDULED);

    (prisma.email.findUnique as jest.Mock).mockImplementation(async () => ({ ...email }));
    (prisma.email.updateMany as jest.Mock).mockImplementation(async ({ where, data }) => {
      if (!where.status.in.includes(email.status)) {
        return { count: 0 };
      }
      email.status = data.status;
      return { count: 1 };
    });

    const originalSmtpResult = {
      messageId: '<smtp-msg-unique-12345@ethereal.email>',
      previewUrl: 'https://ethereal.email/message/msg-12345',
    };
    (etherealService.sendEmail as jest.Mock).mockResolvedValue(originalSmtpResult);

    // Setup transaction mock:
    // Attempt 1: Claim transaction succeeds, but finalization transaction fails
    // Attempt 2: Finalization transaction succeeds
    let finalizationAttempts = 0;
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg) => {
      if (typeof arg === 'function') {
        // Atomic claim callback
        const txClient = {
          email: { updateMany: prisma.email.updateMany },
          emailEvent: { create: prisma.emailEvent.create },
        };
        return arg(txClient);
      }
      if (Array.isArray(arg)) {
        // Finalization transaction batch: [email.update, campaign.update, emailEvent.create]
        finalizationAttempts++;
        if (finalizationAttempts <= 3) {
          // Fail all 3 local attempts in Attempt 1 to simulate a persistent DB outage
          throw new Error('Database connection lost during SENT update');
        }
        // Attempt 2 (retry): DB has recovered, update email state to SENT
        email.status = EmailStatus.SENT;
        return [{}, {}, {}];
      }
    });

    const jobAttempt1 = createMockJob(emailId, 0);

    // Run Attempt 1: SMTP succeeds, but DB finalization fails and bubbles error
    await expect((worker as any).processEmailJob(emailId, jobAttempt1)).rejects.toThrow(
      'Database connection lost during SENT update'
    );

    // Verify SMTP was called on attempt 1
    expect(etherealService.sendEmail).toHaveBeenCalledTimes(1);

    // Verify dispatch receipt was persisted in Redis
    const receiptKey = `reachflow:dispatch_receipt:${emailId}`;
    expect(redisStore.has(receiptKey)).toBe(true);
    const receipt: DispatchReceipt = JSON.parse(redisStore.get(receiptKey)!);
    expect(receipt.messageId).toBe(originalSmtpResult.messageId);
    expect(receipt.previewUrl).toBe(originalSmtpResult.previewUrl);

    // Email status in DB was NOT reverted to SCHEDULED; it remains PROCESSING
    expect(email.status).toBe(EmailStatus.PROCESSING);

    // Run Attempt 2: BullMQ retries the job
    const jobAttempt2 = createMockJob(emailId, 1);
    await (worker as any).processEmailJob(emailId, jobAttempt2);

    // CRITICAL ASSERTION: SMTP must NOT have been called again!
    expect(etherealService.sendEmail).toHaveBeenCalledTimes(1);

    // Final email state is now SENT in PostgreSQL
    expect(email.status).toBe(EmailStatus.SENT);

    // Verify the messageId and previewUrl used for DB update came from the original SMTP result
    expect(prisma.email.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: emailId },
        data: expect.objectContaining({
          status: EmailStatus.SENT,
          messageId: originalSmtpResult.messageId,
          previewUrl: originalSmtpResult.previewUrl,
        }),
      })
    );
  });

  /**
   * TEST 2 — REAL SMTP FAILURE
   * "retries SMTP when SMTP itself fails"
   */
  it('retries SMTP when SMTP itself fails', async () => {
    const emailId = 'email-real-smtp-failure-test';
    const email = createMockEmail(emailId, EmailStatus.SCHEDULED);

    (prisma.email.findUnique as jest.Mock).mockImplementation(async () => ({ ...email }));
    (prisma.email.updateMany as jest.Mock).mockImplementation(async ({ where, data }) => {
      if (!where.status.in.includes(email.status)) {
        return { count: 0 };
      }
      email.status = data.status;
      return { count: 1 };
    });
    (prisma.email.update as jest.Mock).mockImplementation(async ({ data }) => {
      if (data.status) email.status = data.status;
      return {};
    });

    (prisma.$transaction as jest.Mock).mockImplementation(async (arg) => {
      if (typeof arg === 'function') {
        const txClient = {
          email: { updateMany: prisma.email.updateMany },
          emailEvent: { create: prisma.emailEvent.create },
        };
        return arg(txClient);
      }
      if (Array.isArray(arg)) {
        return Promise.all(arg);
      }
    });

    // Attempt 1: SMTP throws network error
    // Attempt 2: SMTP succeeds
    (etherealService.sendEmail as jest.Mock)
      .mockRejectedValueOnce(new Error('SMTP connection timeout'))
      .mockResolvedValueOnce({
        messageId: '<smtp-recovered-999@ethereal.email>',
        previewUrl: 'https://ethereal.email/message/999',
      });

    const jobAttempt1 = createMockJob(emailId, 0);

    // Attempt 1 execution
    await expect((worker as any).processEmailJob(emailId, jobAttempt1)).rejects.toThrow(
      'SMTP connection timeout'
    );

    // First attempt failed: NO dispatch receipt should exist in Redis
    const receiptKey = `reachflow:dispatch_receipt:${emailId}`;
    expect(redisStore.has(receiptKey)).toBe(false);

    // On genuine SMTP failure, email is rolled back to SCHEDULED so BullMQ can retry
    expect(email.status).toBe(EmailStatus.SCHEDULED);

    // Attempt 2: BullMQ retries
    const jobAttempt2 = createMockJob(emailId, 1);
    await (worker as any).processEmailJob(emailId, jobAttempt2);

    // Assert sendEmail was called TWICE (legitimate retry)
    expect(etherealService.sendEmail).toHaveBeenCalledTimes(2);

    // After successful send, dispatch receipt exists and final state is SENT
    expect(redisStore.has(receiptKey)).toBe(true);
    expect(email.status).toBe(EmailStatus.SENT);
  });

  /**
   * TEST 3 — DB RECOVERS
   * "recovers from transient DB failure after SMTP success"
   */
  it('recovers from transient DB failure after SMTP success', async () => {
    const emailId = 'email-transient-db-recovery-test';
    const email = createMockEmail(emailId, EmailStatus.SCHEDULED);

    (prisma.email.findUnique as jest.Mock).mockImplementation(async () => ({ ...email }));
    (prisma.email.updateMany as jest.Mock).mockImplementation(async ({ where, data }) => {
      if (!where.status.in.includes(email.status)) {
        return { count: 0 };
      }
      email.status = data.status;
      return { count: 1 };
    });

    (etherealService.sendEmail as jest.Mock).mockResolvedValue({
      messageId: '<smtp-transient-db-msg@ethereal.email>',
      previewUrl: false,
    });

    // Simulate transient failure: first finalization attempt throws, second succeeds
    let dbFinalizationCount = 0;
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg) => {
      if (typeof arg === 'function') {
        const txClient = {
          email: { updateMany: prisma.email.updateMany },
          emailEvent: { create: prisma.emailEvent.create },
        };
        return arg(txClient);
      }
      if (Array.isArray(arg)) {
        dbFinalizationCount++;
        if (dbFinalizationCount === 1) {
          throw new Error('Lock contention on campaign counter');
        }
        email.status = EmailStatus.SENT;
        return [{}, {}, {}];
      }
    });

    const job = createMockJob(emailId, 0);

    // Run worker: local retry within finalizeSentStatus should recover on attempt 2
    await (worker as any).processEmailJob(emailId, job);

    // SMTP must only be called ONCE
    expect(etherealService.sendEmail).toHaveBeenCalledTimes(1);

    // DB finalization transaction was attempted multiple times (transient recovery)
    expect(dbFinalizationCount).toBe(2);

    // Final state is SENT
    expect(email.status).toBe(EmailStatus.SENT);
  });

  /**
   * TEST 4 — RECEIPT REPLAY
   * "uses existing dispatch receipt without calling SMTP"
   */
  it('uses existing dispatch receipt without calling SMTP', async () => {
    const emailId = 'email-receipt-replay-test';
    // Email is in PROCESSING state (as left after an interrupted prior run)
    const email = createMockEmail(emailId, EmailStatus.PROCESSING);

    (prisma.email.findUnique as jest.Mock).mockImplementation(async () => ({ ...email }));
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg) => {
      if (Array.isArray(arg)) {
        email.status = EmailStatus.SENT;
        return [{}, {}, {}];
      }
    });

    // Pre-populate an authoritative dispatch receipt in Redis
    const preExistingReceipt: DispatchReceipt = {
      messageId: '<pre-existing-msg-id-777@ethereal.email>',
      previewUrl: 'https://ethereal.email/message/777',
      sentAt: new Date().toISOString(),
    };
    redisStore.set(`reachflow:dispatch_receipt:${emailId}`, JSON.stringify(preExistingReceipt));

    const job = createMockJob(emailId, 1);
    await (worker as any).processEmailJob(emailId, job);

    // SMTP send must NOT be called
    expect(etherealService.sendEmail).not.toHaveBeenCalled();

    // PostgreSQL finalization was executed using the pre-existing messageId
    expect(prisma.email.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: emailId },
        data: expect.objectContaining({
          status: EmailStatus.SENT,
          messageId: preExistingReceipt.messageId,
          previewUrl: preExistingReceipt.previewUrl,
        }),
      })
    );

    expect(email.status).toBe(EmailStatus.SENT);
  });

  /**
   * TEST 5 — EXISTING SENT EMAIL
   * "verify existing SENT behavior remains idempotent without calling SMTP"
   */
  it('verify existing SENT behavior remains idempotent without calling SMTP', async () => {
    const emailId = 'email-already-sent-test';
    const email = createMockEmail(emailId, EmailStatus.SENT);

    (prisma.email.findUnique as jest.Mock).mockResolvedValue(email);

    const job = createMockJob(emailId, 0);
    await (worker as any).processEmailJob(emailId, job);

    // Must not call SMTP
    expect(etherealService.sendEmail).not.toHaveBeenCalled();
    // Must not attempt claim or finalization
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
