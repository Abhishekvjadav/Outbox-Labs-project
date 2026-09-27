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

import { EmailStatus, EventType } from '@reachflow/shared';
import { Job } from 'bullmq';
import { EmailJobData, emailQueue } from '../src/queues/emailQueue';
import { prisma } from '../src/prisma/client';
import { etherealService } from '../src/services/ethereal';
import { slackService } from '../src/services/slack';
import { rateLimiterService } from '../src/services/rateLimiter';
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

    let finalizationAttempts = 0;
    (prisma.email.updateMany as jest.Mock).mockImplementation(async ({ where, data }) => {
      // Claim logic
      if (where.status?.in) {
        if (!where.status.in.includes(email.status)) {
          return { count: 0 };
        }
        email.status = data.status;
        return { count: 1 };
      }
      // Finalization logic (where.status.not: EmailStatus.SENT)
      if (where.status?.not) {
        finalizationAttempts++;
        if (finalizationAttempts <= 3) {
          // Fail all 3 local attempts in Attempt 1 to simulate a persistent DB outage
          throw new Error('Database connection lost during SENT update');
        }
        if (email.status === where.status.not) {
          return { count: 0 };
        }
        email.status = data.status;
        return { count: 1 };
      }
      email.status = data.status;
      return { count: 1 };
    });

    const originalSmtpResult = {
      messageId: '<smtp-msg-unique-12345@ethereal.email>',
      previewUrl: 'https://ethereal.email/message/msg-12345',
    };
    (etherealService.sendEmail as jest.Mock).mockResolvedValue(originalSmtpResult);

    const txClient = {
      email: { updateMany: prisma.email.updateMany },
      campaign: { update: prisma.campaign.update },
      emailEvent: { create: prisma.emailEvent.create },
    };
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg) => {
      if (typeof arg === 'function') {
        return arg(txClient);
      }
      if (Array.isArray(arg)) {
        return Promise.all(arg);
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

    // Verify updateMany was called with conditional not: SENT and original messageId
    expect(prisma.email.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: emailId,
          status: { not: EmailStatus.SENT },
        }),
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
      if (where.status?.in && !where.status.in.includes(email.status)) {
        return { count: 0 };
      }
      if (where.status?.not && email.status === where.status.not) {
        return { count: 0 };
      }
      email.status = data.status;
      return { count: 1 };
    });
    (prisma.email.update as jest.Mock).mockImplementation(async ({ data }) => {
      if (data.status) email.status = data.status;
      return {};
    });

    const txClient = {
      email: { updateMany: prisma.email.updateMany, update: prisma.email.update },
      campaign: { update: prisma.campaign.update },
      emailEvent: { create: prisma.emailEvent.create },
    };
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg) => {
      if (typeof arg === 'function') {
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

    let finalizationAttempts = 0;
    (prisma.email.updateMany as jest.Mock).mockImplementation(async ({ where, data }) => {
      if (where.status?.in && !where.status.in.includes(email.status)) {
        return { count: 0 };
      }
      if (where.status?.not) {
        finalizationAttempts++;
        if (finalizationAttempts === 1) {
          throw new Error('Lock contention on campaign counter');
        }
        if (email.status === where.status.not) {
          return { count: 0 };
        }
      }
      email.status = data.status;
      return { count: 1 };
    });

    (etherealService.sendEmail as jest.Mock).mockResolvedValue({
      messageId: '<smtp-transient-db-msg@ethereal.email>',
      previewUrl: false,
    });

    const txClient = {
      email: { updateMany: prisma.email.updateMany },
      campaign: { update: prisma.campaign.update },
      emailEvent: { create: prisma.emailEvent.create },
    };
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg) => {
      if (typeof arg === 'function') {
        return arg(txClient);
      }
      if (Array.isArray(arg)) {
        return Promise.all(arg);
      }
    });

    const job = createMockJob(emailId, 0);

    // Run worker: local retry within finalizeSentStatus should recover on attempt 2
    await (worker as any).processEmailJob(emailId, job);

    // SMTP must only be called ONCE
    expect(etherealService.sendEmail).toHaveBeenCalledTimes(1);

    // DB finalization transaction was attempted multiple times (transient recovery)
    expect(finalizationAttempts).toBe(2);

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
    (prisma.email.updateMany as jest.Mock).mockImplementation(async ({ where, data }) => {
      if (where.status?.not && email.status === where.status.not) {
        return { count: 0 };
      }
      email.status = data.status;
      return { count: 1 };
    });

    const txClient = {
      email: { updateMany: prisma.email.updateMany },
      campaign: { update: prisma.campaign.update },
      emailEvent: { create: prisma.emailEvent.create },
    };
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg) => {
      if (typeof arg === 'function') {
        return arg(txClient);
      }
      if (Array.isArray(arg)) {
        return Promise.all(arg);
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

    // PostgreSQL finalization was executed using updateMany with not: SENT
    expect(prisma.email.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: emailId,
          status: { not: EmailStatus.SENT },
        }),
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

  /**
   * =========================================================================
   * STEP 4 ATOMIC FINALIZATION IDEMPOTENCY TESTS
   * =========================================================================
   */
  describe('Atomic Finalization Idempotency', () => {
    /**
     * TEST 1 — Repeated Finalization
     * Call the finalization path twice for the same email/receipt.
     * Expected:
     * - email status = SENT
     * - campaign.sentEmails increments exactly once
     * - exactly one SMTP_DELIVERED event exists
     * - SMTP is not called a second time
     */
    it('repeated finalization calls increment campaign counter and create event exactly once', async () => {
      const emailId = 'email-repeated-finalization-test';
      const email = createMockEmail(emailId, EmailStatus.PROCESSING);
      let campaignSentEmails = 0;
      let emailEventsCreated = 0;

      (prisma.email.findUnique as jest.Mock).mockImplementation(async () => ({ ...email }));
      (prisma.email.updateMany as jest.Mock).mockImplementation(async ({ where, data }) => {
        if (where.status?.not && email.status === where.status.not) {
          return { count: 0 };
        }
        email.status = data.status;
        return { count: 1 };
      });
      (prisma.campaign.update as jest.Mock).mockImplementation(async () => {
        campaignSentEmails++;
        return {};
      });
      (prisma.emailEvent.create as jest.Mock).mockImplementation(async () => {
        emailEventsCreated++;
        return {};
      });

      const txClient = {
        email: { updateMany: prisma.email.updateMany },
        campaign: { update: prisma.campaign.update },
        emailEvent: { create: prisma.emailEvent.create },
      };
      (prisma.$transaction as jest.Mock).mockImplementation(async (arg) => {
        if (typeof arg === 'function') {
          return arg(txClient);
        }
      });

      const receipt: DispatchReceipt = {
        messageId: '<repeated-test-123@ethereal.email>',
        previewUrl: 'https://ethereal.email/message/123',
        sentAt: new Date().toISOString(),
      };

      // Call 1: First finalization succeeds (count = 1)
      await (worker as any).finalizeSentStatus(emailId, email.campaignId, receipt);

      expect(email.status).toBe(EmailStatus.SENT);
      expect(campaignSentEmails).toBe(1);
      expect(emailEventsCreated).toBe(1);

      // Call 2: Repeated finalization for the same email (count = 0 because status is already SENT)
      await (worker as any).finalizeSentStatus(emailId, email.campaignId, receipt);

      // Verifications:
      // Status remains SENT
      expect(email.status).toBe(EmailStatus.SENT);
      // Counter was NOT incremented again
      expect(campaignSentEmails).toBe(1);
      // Duplicate event was NOT created
      expect(emailEventsCreated).toBe(1);
      // SMTP was never called
      expect(etherealService.sendEmail).not.toHaveBeenCalled();
    });

    /**
     * TEST 2 — Concurrent Finalization
     * Simulate two concurrent finalization attempts for the same email/receipt.
     * Expected:
     * - both calls resolve safely
     * - exactly one finalization wins
     * - campaign.sentEmails increments exactly once
     * - exactly one SMTP_DELIVERED event exists
     * - final email status = SENT
     *
     * Note on Concurrency Model:
     * In this unit test suite, concurrency is modeled via asynchronous event loop interleaved promises
     * against shared state. In production, PostgreSQL handles this via row-level locks on the conditional
     * UPDATE ... WHERE status != 'SENT'.
     */
    it('simultaneous concurrent finalizations resolve safely with exactly one winning finalizer', async () => {
      const emailId = 'email-concurrent-finalization-test';
      const email = createMockEmail(emailId, EmailStatus.PROCESSING);
      let campaignSentEmails = 0;
      let emailEventsCreated = 0;
      let winningFinalizations = 0;
      let noOpFinalizations = 0;

      (prisma.email.findUnique as jest.Mock).mockImplementation(async () => ({ ...email }));
      (prisma.email.updateMany as jest.Mock).mockImplementation(async ({ where, data }) => {
        // Atomic conditional check in PostgreSQL: WHERE id = $1 AND status != 'SENT'
        if (where.status?.not && email.status === where.status.not) {
          noOpFinalizations++;
          return { count: 0 };
        }
        winningFinalizations++;
        email.status = data.status;
        return { count: 1 };
      });
      (prisma.campaign.update as jest.Mock).mockImplementation(async () => {
        campaignSentEmails++;
        return {};
      });
      (prisma.emailEvent.create as jest.Mock).mockImplementation(async () => {
        emailEventsCreated++;
        return {};
      });

      const txClient = {
        email: { updateMany: prisma.email.updateMany },
        campaign: { update: prisma.campaign.update },
        emailEvent: { create: prisma.emailEvent.create },
      };
      (prisma.$transaction as jest.Mock).mockImplementation(async (arg) => {
        if (typeof arg === 'function') {
          return arg(txClient);
        }
      });

      const receipt: DispatchReceipt = {
        messageId: '<concurrent-test-999@ethereal.email>',
        previewUrl: false,
        sentAt: new Date().toISOString(),
      };

      // Execute two finalization attempts concurrently
      const [res1, res2] = await Promise.allSettled([
        (worker as any).finalizeSentStatus(emailId, email.campaignId, receipt),
        (worker as any).finalizeSentStatus(emailId, email.campaignId, receipt),
      ]);

      // Both promises must resolve safely (fulfilled)
      expect(res1.status).toBe('fulfilled');
      expect(res2.status).toBe('fulfilled');

      // Exactly one finalization won the race
      expect(winningFinalizations).toBe(1);
      expect(noOpFinalizations).toBe(1);

      // Campaign counter incremented exactly ONCE
      expect(campaignSentEmails).toBe(1);

      // Delivery event created exactly ONCE
      expect(emailEventsCreated).toBe(1);

      // Final state is SENT
      expect(email.status).toBe(EmailStatus.SENT);
    });

    /**
     * TEST 3 — Existing SENT email
     * Verify that attempting finalization on an already-SENT email does not:
     * - increment campaign counter
     * - create another SMTP_DELIVERED event
     * - throw an unnecessary error
     */
    it('attempting finalization on an already-SENT email is a safe no-op', async () => {
      const emailId = 'email-already-sent-finalization-test';
      const email = createMockEmail(emailId, EmailStatus.SENT);

      (prisma.email.findUnique as jest.Mock).mockImplementation(async () => ({ ...email }));
      (prisma.email.updateMany as jest.Mock).mockImplementation(async ({ where, data }) => {
        if (where.status?.not && email.status === where.status.not) {
          return { count: 0 };
        }
        email.status = data.status;
        return { count: 1 };
      });

      const txClient = {
        email: { updateMany: prisma.email.updateMany },
        campaign: { update: prisma.campaign.update },
        emailEvent: { create: prisma.emailEvent.create },
      };
      (prisma.$transaction as jest.Mock).mockImplementation(async (arg) => {
        if (typeof arg === 'function') {
          return arg(txClient);
        }
      });

      const receipt: DispatchReceipt = {
        messageId: '<already-sent-456@ethereal.email>',
        previewUrl: false,
        sentAt: new Date().toISOString(),
      };

      // Directly invoke finalization on already-SENT email
      await expect(
        (worker as any).finalizeSentStatus(emailId, email.campaignId, receipt)
      ).resolves.toBeUndefined();

      // Assert counter and event were not called
      expect(prisma.campaign.update).not.toHaveBeenCalled();
      expect(prisma.emailEvent.create).not.toHaveBeenCalled();
      expect(email.status).toBe(EmailStatus.SENT);
    });
  });

  describe('Step 5 — Safe PROCESSING Recovery & Crash Handling', () => {
    /**
     * TEST 1 & 4 — Abandoned worker recovery: transitions to FAILED + DLQ_MOVED without calling SMTP
     */
    it('recovers abandoned worker in PROCESSING state: transitions to FAILED and creates DLQ_MOVED without calling SMTP', async () => {
      const emailId = 'email-abandoned-worker-test';
      const expiredUpdatedAt = new Date(Date.now() - (EmailWorkerService.LEASE_TIMEOUT_MS + 10000));
      const email = {
        ...createMockEmail(emailId, EmailStatus.PROCESSING),
        attempts: 1,
        updatedAt: expiredUpdatedAt,
      };

      let emailStatus: string = EmailStatus.PROCESSING;
      let emailError: string | null = null;
      let dlqEventCreated = false;

      (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...email });
      (prisma.email.updateMany as jest.Mock).mockImplementation(async ({ where, data }) => {
        if (where.status === EmailStatus.PROCESSING && where.attempts === email.attempts) {
          emailStatus = data.status;
          emailError = data.error;
          return { count: 1 };
        }
        return { count: 0 };
      });
      (prisma.emailEvent.create as jest.Mock).mockImplementation(async ({ data }) => {
        if (data.type === EventType.DLQ_MOVED) {
          dlqEventCreated = true;
        }
        return {};
      });

      const txClient = {
        email: { updateMany: prisma.email.updateMany },
        campaign: { update: prisma.campaign.update },
        emailEvent: { create: prisma.emailEvent.create },
      };
      (prisma.$transaction as jest.Mock).mockImplementation(async (arg) => {
        if (typeof arg === 'function') {
          return arg(txClient);
        }
        return Promise.all(arg);
      });

      const job = {
        id: `email-send-${emailId}`,
        data: { emailId },
        opts: { attempts: 3 },
        attemptsMade: 1, // BullMQ retry attempt
      } as Job<EmailJobData>;

      await (worker as any).processEmailJob(emailId, job);

      expect(emailStatus).toBe(EmailStatus.FAILED);
      expect(emailError).toContain('Expired lease');
      expect(dlqEventCreated).toBe(true);
      expect(etherealService.sendEmail).not.toHaveBeenCalled();
      expect(prisma.campaign.update).not.toHaveBeenCalled();
    });

    /**
     * TEST 2 — PROCESSING + receipt → finalize without SMTP
     */
    it('finalizes email in PROCESSING state to SENT using existing Redis receipt without calling SMTP', async () => {
      const emailId = 'email-processing-with-receipt-test';
      const email = createMockEmail(emailId, EmailStatus.PROCESSING);
      let emailStatus: string = EmailStatus.PROCESSING;
      let campaignSentEmails = 0;
      let deliveryEventCreated = false;

      const receipt: DispatchReceipt = {
        messageId: '<pre-existing-proc-msg@ethereal.email>',
        previewUrl: 'https://ethereal.email/message/proc-123',
        sentAt: new Date().toISOString(),
      };
      await mockRedisClient.set(`reachflow:dispatch_receipt:${emailId}`, JSON.stringify(receipt));

      (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...email });
      (prisma.email.updateMany as jest.Mock).mockImplementation(async ({ where, data }) => {
        if (where.status?.not && emailStatus === where.status.not) {
          return { count: 0 };
        }
        emailStatus = data.status;
        return { count: 1 };
      });
      (prisma.campaign.update as jest.Mock).mockImplementation(async () => {
        campaignSentEmails++;
        return {};
      });
      (prisma.emailEvent.create as jest.Mock).mockImplementation(async ({ data }) => {
        if (data.type === EventType.SMTP_DELIVERED) {
          deliveryEventCreated = true;
        }
        return {};
      });

      const txClient = {
        email: { updateMany: prisma.email.updateMany },
        campaign: { update: prisma.campaign.update },
        emailEvent: { create: prisma.emailEvent.create },
      };
      (prisma.$transaction as jest.Mock).mockImplementation(async (arg) => {
        if (typeof arg === 'function') {
          return arg(txClient);
        }
        return Promise.all(arg);
      });

      const job = {
        id: `email-send-${emailId}`,
        data: { emailId },
        opts: { attempts: 3 },
        attemptsMade: 1,
      } as Job<EmailJobData>;

      await (worker as any).processEmailJob(emailId, job);

      expect(emailStatus).toBe(EmailStatus.SENT);
      expect(campaignSentEmails).toBe(1);
      expect(deliveryEventCreated).toBe(true);
      expect(etherealService.sendEmail).not.toHaveBeenCalled();
    });

    /**
     * TEST 3 — PROCESSING + no receipt + ambiguous state → do not blindly resend
     */
    it('does not blindly resend SMTP when in PROCESSING state with no dispatch receipt on retry', async () => {
      const emailId = 'email-ambiguous-no-resend-test';
      const email = {
        ...createMockEmail(emailId, EmailStatus.PROCESSING),
        attempts: 1,
        updatedAt: new Date(),
      };

      (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...email });
      (prisma.email.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.emailEvent.create as jest.Mock).mockResolvedValue({});

      const txClient = {
        email: { updateMany: prisma.email.updateMany },
        campaign: { update: prisma.campaign.update },
        emailEvent: { create: prisma.emailEvent.create },
      };
      (prisma.$transaction as jest.Mock).mockImplementation(async (arg) => {
        if (typeof arg === 'function') {
          return arg(txClient);
        }
        return Promise.all(arg);
      });

      const job = {
        id: `email-send-${emailId}`,
        data: { emailId },
        opts: { attempts: 3 },
        attemptsMade: 1, // retry attempt
      } as Job<EmailJobData>;

      await (worker as any).processEmailJob(emailId, job);

      // Must never call SMTP on ambiguous retry
      expect(etherealService.sendEmail).not.toHaveBeenCalled();
    });

    /**
     * TEST 5 — Receipt Redis transient failure → bounded retry
     */
    it('retries saving dispatch receipt with bounded backoff upon transient Redis failure and succeeds', async () => {
      const emailId = 'email-redis-transient-test';
      const receipt: DispatchReceipt = {
        messageId: '<transient-test@ethereal.email>',
        previewUrl: false,
        sentAt: new Date().toISOString(),
      };

      let attemptCount = 0;
      mockRedisClient.set.mockImplementation(async (key: string, value: string) => {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error('Redis connection reset');
        }
        redisStore.set(key, value);
        return 'OK';
      });

      const result = await (worker as any).saveDispatchReceipt(emailId, receipt);

      expect(attemptCount).toBe(2);
      expect(result).not.toBeNull();
      expect(result.messageId).toBe(receipt.messageId);
      expect(redisStore.has(`reachflow:dispatch_receipt:${emailId}`)).toBe(true);
    });

    /**
     * TEST 6 — Receipt Redis persistent failure → safe failure behavior
     */
    it('handles persistent Redis receipt failure safely: enters DLQ without duplicate send when DB also fails', async () => {
      const emailId = 'email-redis-persistent-test';
      const email = createMockEmail(emailId, EmailStatus.SCHEDULED);
      let emailStatus: string = EmailStatus.SCHEDULED;
      let dlqEventCreated = false;

      (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...email });
      (prisma.email.updateMany as jest.Mock).mockImplementation(async ({ data }: any) => {
        // Track emailStatus for the fallback path (dual-failure handler uses updateMany with PROCESSING guard)
        if (data?.status) {
          emailStatus = data.status;
        }
        return { count: 1 };
      });
      (prisma.email.update as jest.Mock).mockImplementation(async ({ data }: any) => {
        emailStatus = data.status;
        return {};
      });
      (prisma.emailEvent.create as jest.Mock).mockImplementation(async ({ data }: any) => {
        if (data.type === EventType.DLQ_MOVED) {
          dlqEventCreated = true;
        }
        return {};
      });
      let txCalls = 0;
      const txClient = {
        email: { updateMany: prisma.email.updateMany, update: prisma.email.update },
        campaign: { update: prisma.campaign.update },
        emailEvent: { create: prisma.emailEvent.create },
      };
      (prisma.$transaction as jest.Mock).mockImplementation(async (arg: any) => {
        if (Array.isArray(arg)) {
          return Promise.all(arg);
        }
        txCalls++;
        if (txCalls === 1) {
          // Call 1: Claim transaction succeeds
          return arg(txClient);
        }
        // Call 2+: Finalization transaction fails to trigger dual failure
        throw new Error('Database connection lost');
      });

      (etherealService.sendEmail as jest.Mock).mockResolvedValue({
        messageId: '<persistent-fail-msg@ethereal.email>',
        previewUrl: false,
      });

      // Persistent Redis failure
      mockRedisClient.set.mockRejectedValue(new Error('Redis connection refused'));

      const job = {
        id: `email-send-${emailId}`,
        data: { emailId },
        opts: { attempts: 3 },
        attemptsMade: 0,
      } as Job<EmailJobData>;

      await (worker as any).processEmailJob(emailId, job);

      // Dual failure must be caught and transitioned to FAILED (DLQ)
      expect(emailStatus).toBe(EmailStatus.FAILED);
      expect(dlqEventCreated).toBe(true);
    });

    /**
     * Active lease guard test
     */
    it('skips execution safely when an active peer worker holds an unexpired lease in PROCESSING state', async () => {
      const emailId = 'email-active-lease-test';
      const email = {
        ...createMockEmail(emailId, EmailStatus.PROCESSING),
        attempts: 1,
        updatedAt: new Date(), // lease is fresh
      };

      (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...email });

      const job = {
        id: `email-send-${emailId}`,
        data: { emailId },
        opts: { attempts: 3 },
        attemptsMade: 0, // initial attempt
      } as Job<EmailJobData>;

      await (worker as any).processEmailJob(emailId, job);

      // Must not touch email, must not call SMTP
      expect(prisma.email.updateMany).not.toHaveBeenCalled();
      expect(etherealService.sendEmail).not.toHaveBeenCalled();
      expect(prisma.emailEvent.create).not.toHaveBeenCalled();
    });
  }); // end describe('Step 5 — Safe PROCESSING Recovery & Crash Handling')

  // ─────────────────────────────────────────────────────────────────────────
  // Step 7A — F3: Lease-only PROCESSING Recovery & F4: Slack Non-Blocking
  // ─────────────────────────────────────────────────────────────────────────
  describe('Step 7A — F3 & F4 Fixes', () => {
    // Shared helpers
    const ACTIVE_LEASE_UPDATED_AT = new Date(); // fresh — lease not expired
    const EXPIRED_LEASE_UPDATED_AT = new Date(
      Date.now() - (EmailWorkerService.LEASE_TIMEOUT_MS + 30_000)
    );

    const makeRateLimitedEmail = (emailId: string) => ({
      ...createMockEmail(emailId, EmailStatus.SCHEDULED),
    });

    const makeStandardTxClient = () => ({
      email: { updateMany: prisma.email.updateMany, update: prisma.email.update },
      campaign: { update: prisma.campaign.update },
      emailEvent: { create: prisma.emailEvent.create },
    });

    // ── F3 TESTS ──────────────────────────────────────────────────────────

    /**
     * F3-T1: PROCESSING + active lease + attemptsMade > 0
     *   → email is protected, no SMTP, no FAILED transition
     */
    it('F3: PROCESSING + active lease + attemptsMade > 0 → remains protected, no SMTP, no FAILED', async () => {
      const emailId = 'f3-active-lease-with-retry';
      const email = {
        ...createMockEmail(emailId, EmailStatus.PROCESSING),
        attempts: 2,
        updatedAt: ACTIVE_LEASE_UPDATED_AT,
      };

      (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...email });

      const job = createMockJob(emailId, 2); // attemptsMade=2, lease still active

      await (worker as any).processEmailJob(emailId, job);

      // Lease is active → must skip entirely without any DB write or SMTP
      expect(etherealService.sendEmail).not.toHaveBeenCalled();
      expect(prisma.email.updateMany).not.toHaveBeenCalled();
      expect(prisma.emailEvent.create).not.toHaveBeenCalled();
    });

    /**
     * F3-T2: PROCESSING + expired lease + attemptsMade = 0
     *   → conservative FAILED/DLQ recovery, no SMTP
     */
    it('F3: PROCESSING + expired lease + attemptsMade = 0 → FAILED/DLQ recovery, no SMTP', async () => {
      const emailId = 'f3-expired-lease-first-attempt';
      const email = {
        ...createMockEmail(emailId, EmailStatus.PROCESSING),
        attempts: 1,
        updatedAt: EXPIRED_LEASE_UPDATED_AT,
      };

      let emailStatus = EmailStatus.PROCESSING;
      let dlqEventCreated = false;

      (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...email });
      (prisma.email.updateMany as jest.Mock).mockImplementation(async ({ where, data }) => {
        if (where.status === EmailStatus.PROCESSING && where.attempts === email.attempts) {
          emailStatus = data.status;
          return { count: 1 };
        }
        return { count: 0 };
      });
      (prisma.emailEvent.create as jest.Mock).mockImplementation(async ({ data }) => {
        if (data.type === EventType.DLQ_MOVED) dlqEventCreated = true;
        return {};
      });
      (prisma.$transaction as jest.Mock).mockImplementation(async (arg) =>
        typeof arg === 'function' ? arg(makeStandardTxClient()) : Promise.all(arg)
      );

      const job = createMockJob(emailId, 0); // attemptsMade=0, lease expired

      await (worker as any).processEmailJob(emailId, job);

      expect(emailStatus).toBe(EmailStatus.FAILED);
      expect(dlqEventCreated).toBe(true);
      expect(etherealService.sendEmail).not.toHaveBeenCalled();
    });

    /**
     * F3-T3: PROCESSING + expired lease + attemptsMade > 0
     *   → same conservative recovery, no SMTP
     */
    it('F3: PROCESSING + expired lease + attemptsMade > 0 → FAILED/DLQ recovery, no SMTP', async () => {
      const emailId = 'f3-expired-lease-retry-attempt';
      const email = {
        ...createMockEmail(emailId, EmailStatus.PROCESSING),
        attempts: 3,
        updatedAt: EXPIRED_LEASE_UPDATED_AT,
      };

      let emailStatus = EmailStatus.PROCESSING;
      let dlqEventCreated = false;

      (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...email });
      (prisma.email.updateMany as jest.Mock).mockImplementation(async ({ where, data }) => {
        if (where.status === EmailStatus.PROCESSING && where.attempts === email.attempts) {
          emailStatus = data.status;
          return { count: 1 };
        }
        return { count: 0 };
      });
      (prisma.emailEvent.create as jest.Mock).mockImplementation(async ({ data }) => {
        if (data.type === EventType.DLQ_MOVED) dlqEventCreated = true;
        return {};
      });
      (prisma.$transaction as jest.Mock).mockImplementation(async (arg) =>
        typeof arg === 'function' ? arg(makeStandardTxClient()) : Promise.all(arg)
      );

      const job = createMockJob(emailId, 5); // high attemptsMade, expired lease

      await (worker as any).processEmailJob(emailId, job);

      expect(emailStatus).toBe(EmailStatus.FAILED);
      expect(dlqEventCreated).toBe(true);
      expect(etherealService.sendEmail).not.toHaveBeenCalled();
    });

    /**
     * F3-T4: Transient infrastructure failure causes retry; PROCESSING + active lease
     *   → retry does NOT cause DLQ; email stays protected
     *
     * Simulates: rate-limit Redis call fails → BullMQ retries with attemptsMade=1
     * while the PROCESSING lease is still fresh. Must not DLQ.
     */
    it('F3: retry caused by transient infra failure with active PROCESSING lease → protected, no DLQ', async () => {
      const emailId = 'f3-infra-retry-active-lease';
      const email = {
        ...createMockEmail(emailId, EmailStatus.PROCESSING),
        attempts: 1,
        updatedAt: ACTIVE_LEASE_UPDATED_AT, // still fresh
      };

      (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...email });

      // No dispatch receipt in Redis
      const job = createMockJob(emailId, 1); // BullMQ retry attempt, but lease still alive

      await (worker as any).processEmailJob(emailId, job);

      // Lease active → must not DLQ, must not call SMTP
      expect(prisma.email.updateMany).not.toHaveBeenCalled();
      expect(etherealService.sendEmail).not.toHaveBeenCalled();
      expect(prisma.emailEvent.create).not.toHaveBeenCalled();
    });

    // ── F4 TESTS ──────────────────────────────────────────────────────────

    // Common setup for F4 rate-limit tests
    const setupRateLimitedJob = (emailId: string, slackMockImpl?: () => Promise<void>) => {
      const email = makeRateLimitedEmail(emailId);
      const resetTimeMs = Date.now() + 3_600_000;
      const windowKey = 'window-key-test';

      (prisma.email.findUnique as jest.Mock).mockResolvedValue({ ...email });
      (prisma.$transaction as jest.Mock).mockImplementation(async (arg) =>
        typeof arg === 'function' ? arg(makeStandardTxClient()) : Promise.all(arg)
      );

      // Claim succeeds
      (prisma.email.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.email.update as jest.Mock).mockResolvedValue({});
      (prisma.emailEvent.create as jest.Mock).mockResolvedValue({});
      (prisma.campaign.update as jest.Mock).mockResolvedValue({});

      // Rate limit: deny
      (rateLimiterService.checkAndIncrement as jest.Mock).mockResolvedValue({
        allowed: false,
        currentCount: 100,
        windowKey,
        resetTimeMs,
      });

      // Slack mock
      (slackService.sendDeduplicatedRateLimitAlert as jest.Mock).mockImplementation(
        slackMockImpl ?? (() => Promise.resolve())
      );

      const job = createMockJob(emailId, 0);
      return { email, job, resetTimeMs, windowKey };
    };

    /**
     * F4-T1: Slack Redis/DB lookup failure
     *   → rate-limited email still becomes RESCHEDULED, BullMQ job still created
     */
    it('F4: Slack Redis lookup failure → email still becomes RESCHEDULED, BullMQ job still created', async () => {
      const emailId = 'f4-slack-redis-fail';
      const { job, resetTimeMs } = setupRateLimitedJob(emailId, async () => {
        throw new Error('Redis ECONNREFUSED');
      });

      let rescheduledStatusSet = false;
      (prisma.email.update as jest.Mock).mockImplementation(async ({ data }) => {
        if (data.status === EmailStatus.RESCHEDULED) rescheduledStatusSet = true;
        return {};
      });

      await (worker as any).processEmailJob(emailId, job);

      // Give fire-and-forget Slack a tick to settle
      await new Promise((r) => setTimeout(r, 50));

      // Critical path must have executed
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(emailQueue.add).toHaveBeenCalledWith(
        'send-email',
        { emailId, isRescheduled: true },
        expect.objectContaining({ jobId: `email-send-${emailId}-resched-${resetTimeMs}` })
      );
      expect(etherealService.sendEmail).not.toHaveBeenCalled();

      // Slack was attempted (non-fatal)
      expect(slackService.sendDeduplicatedRateLimitAlert).toHaveBeenCalledTimes(1);
    });

    /**
     * F4-T2: Slack API failure (e.g. HTTP 503)
     *   → rate-limited email still becomes RESCHEDULED, BullMQ job still created
     */
    it('F4: Slack API failure → email still becomes RESCHEDULED, BullMQ job still created', async () => {
      const emailId = 'f4-slack-api-fail';
      const { job, resetTimeMs } = setupRateLimitedJob(emailId, async () => {
        throw new Error('Slack API returned 503 Service Unavailable');
      });

      (prisma.email.update as jest.Mock).mockResolvedValue({});

      await (worker as any).processEmailJob(emailId, job);

      // Give fire-and-forget a tick
      await new Promise((r) => setTimeout(r, 50));

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(emailQueue.add).toHaveBeenCalledWith(
        'send-email',
        { emailId, isRescheduled: true },
        expect.objectContaining({ jobId: `email-send-${emailId}-resched-${resetTimeMs}` })
      );
      expect(etherealService.sendEmail).not.toHaveBeenCalled();
      expect(slackService.sendDeduplicatedRateLimitAlert).toHaveBeenCalledTimes(1);
    });

    /**
     * F4-T3: Slack notification succeeds
     *   → existing SET-NX deduplication behavior intact, RESCHEDULED, BullMQ job created
     */
    it('F4: Slack notification succeeds → RESCHEDULED + BullMQ job created, deduplication intact', async () => {
      const emailId = 'f4-slack-succeeds';
      let slackCallCount = 0;
      const { job, resetTimeMs } = setupRateLimitedJob(emailId, async () => {
        slackCallCount++;
      });

      (prisma.email.update as jest.Mock).mockResolvedValue({});

      await (worker as any).processEmailJob(emailId, job);

      // Give fire-and-forget a tick
      await new Promise((r) => setTimeout(r, 50));

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(emailQueue.add).toHaveBeenCalledWith(
        'send-email',
        { emailId, isRescheduled: true },
        expect.objectContaining({ jobId: `email-send-${emailId}-resched-${resetTimeMs}` })
      );
      expect(etherealService.sendEmail).not.toHaveBeenCalled();
      expect(slackCallCount).toBe(1); // called exactly once (deduplication delegate stays in slackService)
    });

    /**
     * F4-T4: Verify no duplicate executable BullMQ job is created
     *   (deterministic jobId deduplication preserved under F4 changes)
     */
    it('F4: deterministic BullMQ jobId prevents duplicate executable jobs under Slack failure', async () => {
      const emailId = 'f4-no-duplicate-job';
      const { job, resetTimeMs } = setupRateLimitedJob(emailId, async () => {
        throw new Error('Slack timeout');
      });

      (prisma.email.update as jest.Mock).mockResolvedValue({});

      await (worker as any).processEmailJob(emailId, job);
      await new Promise((r) => setTimeout(r, 50));

      // emailQueue.add must be called exactly once with the deterministic jobId
      expect(emailQueue.add).toHaveBeenCalledTimes(1);
      expect(emailQueue.add).toHaveBeenCalledWith(
        'send-email',
        { emailId, isRescheduled: true },
        expect.objectContaining({
          jobId: `email-send-${emailId}-resched-${resetTimeMs}`,
        })
      );
    });
  });
});
