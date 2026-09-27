/**
 * F7 — SMTP Delivery Ambiguity Protection Tests
 *
 * Requirements:
 * 1. Deterministic Message-ID based on email.id passed to Nodemailer (for correlation, NOT exactly-once).
 * 2. Track whether the SMTP attempt has entered the transmission/send phase.
 * 3. In SMTP error handling:
 *    - Clear pre-send/provider failures may retry normally (reset to SCHEDULED, rethrow to BullMQ).
 *    - Ambiguous connection/timeout errors after transmission begins must NOT reset to SCHEDULED and retry.
 *    - Mark the email FAILED with a clear ambiguity/DLQ event explaining that delivery outcome is unknown
 *      and automatic retry was suppressed.
 * 4. Preserve existing dispatch-receipt protection for successful SMTP + DB failure.
 * 5. Preserve F1 quota compensation, but do NOT compensate if the ambiguous SMTP attempt may have been accepted.
 * 6. Focused F7 tests for:
 *    - deterministic Message-ID
 *    - clear pre-send failure retries
 *    - ambiguous post-transmission failure does not retry
 *    - existing dispatch receipt finalizes without SMTP
 *    - successful SMTP remains SENT
 *    - ambiguous failure creates the correct DLQ/audit event
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
      // COMPENSATE_QUOTA_LUA
      const current = parseInt(mockRedisStore.get(key) || '0', 10);
      if (current > 0) {
        const newVal = Math.max(0, current - 1);
        mockRedisStore.set(key, newVal.toString());
        return newVal;
      }
      return 0;
    }
    if (script.includes('incr')) {
      // CHECK_AND_INCR_LUA
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

describe('F7 — SMTP Ambiguity Protection', () => {
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
    senderEmail?: string;
    senderHourlyLimit?: number;
    status?: string;
  }) => ({
    id: options.emailId,
    status: options.status ?? EmailStatus.SCHEDULED,
    attempts: 0,
    scheduledAt: new Date(),
    senderId: 'sender-f7-test',
    sender: {
      id: 'sender-f7-test',
      email: options.senderEmail ?? 'outreach@salesforce.com',
      name: 'Sales Rep',
      hourlyLimit: options.senderHourlyLimit ?? 100,
      etherealUser: 'ethereal_user',
      etherealPass: 'ethereal_pass',
    },
    campaignId: 'camp-f7-test',
    campaign: {
      id: 'camp-f7-test',
      name: 'F7 Campaign',
      delayMs: 1,
      hourlyLimit: 100,
    },
    userId: 'user-f7',
    user: {},
    recipient: 'client@company.org',
    subject: 'F7 Partnership Proposal',
    body: 'Hello,\nInterested in discussing partnership?\nBest regards.',
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
  // TEST 1: Deterministic Message-ID based on email.id passed to Nodemailer
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 1: generates deterministic Message-ID from email.id and passes it to sendEmail', async () => {
    const emailId = 'email-det-msg-987';
    const email = createMockEmail({ emailId, senderEmail: 'founder@mycompany.io' });

    (prisma.email.findUnique as jest.Mock).mockResolvedValue(email);
    (prisma.email.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.emailEvent.create as jest.Mock).mockResolvedValue({ id: 'evt-1' });
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback: any) => {
      if (typeof callback === 'function') {
        return callback(makeTxClient());
      }
      return [
        { id: emailId, status: EmailStatus.SENT },
        { id: 'evt-1' },
      ];
    });

    (etherealService.sendEmail as jest.Mock).mockResolvedValue({
      messageId: '<reachflow-email-det-msg-987@mycompany.io>',
      previewUrl: 'https://ethereal.email/message/det-987',
    });

    const job = createMockJob(emailId, 0);
    await (worker as any).processEmailJob(emailId, job);

    expect(etherealService.sendEmail).toHaveBeenCalledTimes(1);
    const sendMailCallArgs = (etherealService.sendEmail as jest.Mock).mock.calls[0][0];

    // Assert deterministic Message-ID format: <reachflow-${email.id}@${domain}>
    expect(sendMailCallArgs.messageId).toBe('<reachflow-email-det-msg-987@mycompany.io>');
    expect(typeof sendMailCallArgs.onTransmissionStart).toBe('function');

    // Receipt in Redis contains this deterministic Message-ID
    const receiptKey = `reachflow:dispatch_receipt:${emailId}`;
    expect(mockRedisStore.has(receiptKey)).toBe(true);
    const receipt = JSON.parse(mockRedisStore.get(receiptKey)!);
    expect(receipt.messageId).toBe('<reachflow-email-det-msg-987@mycompany.io>');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 2: Clear pre-send failure retries normally and compensates quota
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 2: clear pre-send failure rolls back to SCHEDULED, compensates quota, and retries', async () => {
    const emailId = 'email-clear-presend-retry';
    const email = createMockEmail({ emailId });

    (prisma.email.findUnique as jest.Mock).mockResolvedValue(email);
    (prisma.email.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.email.update as jest.Mock).mockImplementation(async ({ data }: any) => {
      email.status = data.status ?? email.status;
      return email;
    });
    (prisma.emailEvent.create as jest.Mock).mockResolvedValue({ id: 'evt-fail' });
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: any) =>
      typeof arg === 'function' ? arg(makeTxClient()) : Array.isArray(arg) ? Promise.all(arg) : arg
    );

    const compensateSpy = jest.spyOn(rateLimiterService, 'compensate');

    // Attempt 1: Pre-send connection refused
    const preSendError: any = new Error('connect ECONNREFUSED 127.0.0.1:587');
    preSendError.code = 'ECONNREFUSED';
    preSendError.command = 'CONN';

    (etherealService.sendEmail as jest.Mock).mockRejectedValueOnce(preSendError);

    const job1 = createMockJob(emailId, 0);

    // Attempt 1 must rethrow to BullMQ
    await expect((worker as any).processEmailJob(emailId, job1)).rejects.toThrow(
      'connect ECONNREFUSED 127.0.0.1:587'
    );

    // F1 Quota MUST be compensated because delivery was definitively not attempted
    expect(compensateSpy).toHaveBeenCalledTimes(1);

    // DB status rolled back to SCHEDULED for BullMQ retry
    expect(email.status).toBe(EmailStatus.SCHEDULED);

    // No dispatch receipt exists
    const receiptKey = `reachflow:dispatch_receipt:${emailId}`;
    expect(mockRedisStore.has(receiptKey)).toBe(false);

    // Attempt 2: BullMQ retries and succeeds
    (etherealService.sendEmail as jest.Mock).mockResolvedValueOnce({
      messageId: '<reachflow-email-clear-presend-retry@salesforce.com>',
      previewUrl: 'https://ethereal.email/message/retry-ok',
    });

    const job2 = createMockJob(emailId, 1);
    await (worker as any).processEmailJob(emailId, job2);

    expect(etherealService.sendEmail).toHaveBeenCalledTimes(2);
    expect(mockRedisStore.has(receiptKey)).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 3: Ambiguous post-transmission failure does NOT retry and does NOT compensate quota
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 3: ambiguous post-transmission error marks FAILED, suppresses BullMQ retry, and preserves quota', async () => {
    const emailId = 'email-ambiguous-no-retry';
    const email = createMockEmail({ emailId });

    (prisma.email.findUnique as jest.Mock).mockResolvedValue(email);
    (prisma.email.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.email.update as jest.Mock).mockImplementation(async ({ data }: any) => {
      email.status = data.status ?? email.status;
      return email;
    });
    (prisma.emailEvent.create as jest.Mock).mockResolvedValue({ id: 'evt-ambig' });
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: any) =>
      typeof arg === 'function' ? arg(makeTxClient()) : Array.isArray(arg) ? Promise.all(arg) : arg
    );

    const compensateSpy = jest.spyOn(rateLimiterService, 'compensate');

    // Simulate post-transmission error: socket hang up / ECONNRESET
    const ambiguousError: any = new Error('read ECONNRESET');
    ambiguousError.code = 'ECONNRESET';

    (etherealService.sendEmail as jest.Mock).mockImplementation(async (opts) => {
      // Transmission phase started before connection dropped
      opts.onTransmissionStart?.();
      throw ambiguousError;
    });

    const job = createMockJob(emailId, 0);

    // CRITICAL REQUIREMENT: Worker must NOT rethrow to BullMQ. It must resolve cleanly.
    await expect((worker as any).processEmailJob(emailId, job)).resolves.not.toThrow();

    // 1. Quota is NOT compensated (protects mailbox limit in case remote MTA accepted)
    expect(compensateSpy).not.toHaveBeenCalled();

    // 2. Email is marked FAILED, NOT reset to SCHEDULED
    expect(email.status).toBe(EmailStatus.FAILED);
    expect(prisma.email.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: emailId },
        data: expect.objectContaining({
          status: EmailStatus.FAILED,
          messageId: '<reachflow-email-ambiguous-no-retry@salesforce.com>',
        }),
      })
    );

    // 3. DLQ event is created explaining that outcome is unknown and retry suppressed
    expect(prisma.emailEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          emailId,
          type: EventType.DLQ_MOVED,
          metadata: expect.objectContaining({
            ambiguous: true,
            retrySuppressed: true,
          }),
        }),
      })
    );

    // 4. Assert sendEmail was called only once
    expect(etherealService.sendEmail).toHaveBeenCalledTimes(1);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 4: Existing dispatch receipt finalizes without calling SMTP
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 4: existing dispatch receipt in Redis bypasses SMTP and finalizes as SENT', async () => {
    const emailId = 'email-existing-receipt-test';
    const email = createMockEmail({ emailId, status: EmailStatus.PROCESSING });

    // Pre-populate dispatch receipt in Redis (e.g. from prior successful SMTP attempt)
    const receiptKey = `reachflow:dispatch_receipt:${emailId}`;
    const preExistingReceipt = {
      messageId: '<reachflow-prior-delivery-123@salesforce.com>',
      previewUrl: 'https://ethereal.email/message/prior-123',
      sentAt: new Date().toISOString(),
    };
    mockRedisStore.set(receiptKey, JSON.stringify(preExistingReceipt));

    (prisma.email.findUnique as jest.Mock).mockResolvedValue(email);
    (prisma.email.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.emailEvent.create as jest.Mock).mockResolvedValue({ id: 'evt-receipt' });
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback: any) => {
      if (typeof callback === 'function') {
        return callback(makeTxClient());
      }
      return [{ id: emailId, status: EmailStatus.SENT }];
    });

    const job = createMockJob(emailId, 1);
    await (worker as any).processEmailJob(emailId, job);

    // Ethereal SMTP must NEVER be called when receipt exists
    expect(etherealService.sendEmail).not.toHaveBeenCalled();
    // Dispatch receipt remains in Redis
    expect(mockRedisStore.has(receiptKey)).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 5: Successful SMTP remains SENT
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 5: successful SMTP dispatch records receipt and finalizes email to SENT', async () => {
    const emailId = 'email-happy-path-sent';
    const email = createMockEmail({ emailId });

    (prisma.email.findUnique as jest.Mock).mockResolvedValue(email);
    (prisma.email.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.emailEvent.create as jest.Mock).mockResolvedValue({ id: 'evt-sent' });

    let finalStatus: string | null = null;
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback: any) => {
      if (typeof callback === 'function') {
        const txClient = {
          email: {
            updateMany: jest.fn().mockImplementation(async ({ data }: any) => {
              finalStatus = data.status;
              return { count: 1 };
            }),
          },
          campaign: { update: jest.fn().mockResolvedValue({}) },
          emailEvent: { create: jest.fn().mockResolvedValue({ id: 'evt-sent' }) },
        };
        return callback(txClient);
      }
      return [];
    });

    (etherealService.sendEmail as jest.Mock).mockResolvedValue({
      messageId: '<reachflow-email-happy-path-sent@salesforce.com>',
      previewUrl: 'https://ethereal.email/message/sent-ok',
    });

    const job = createMockJob(emailId, 0);
    await (worker as any).processEmailJob(emailId, job);

    expect(etherealService.sendEmail).toHaveBeenCalledTimes(1);
    expect(finalStatus).toBe(EmailStatus.SENT);

    // Dispatch receipt preserved in Redis
    const receiptKey = `reachflow:dispatch_receipt:${emailId}`;
    expect(mockRedisStore.has(receiptKey)).toBe(true);
    const receipt = JSON.parse(mockRedisStore.get(receiptKey)!);
    expect(receipt.messageId).toBe('<reachflow-email-happy-path-sent@salesforce.com>');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 6: Ambiguous failure creates correct DLQ and audit event metadata
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 6: ambiguous failure creates DLQ_MOVED event with full audit metadata', async () => {
    const emailId = 'email-audit-metadata-test';
    const email = createMockEmail({ emailId });

    (prisma.email.findUnique as jest.Mock).mockResolvedValue(email);
    (prisma.email.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.email.update as jest.Mock).mockResolvedValue({});
    (prisma.emailEvent.create as jest.Mock).mockResolvedValue({});
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: any) =>
      typeof arg === 'function' ? arg(makeTxClient()) : Array.isArray(arg) ? Promise.all(arg) : arg
    );

    // Simulate timeout during DATA command
    const timeoutError: any = new Error('Socket timed out waiting for server 250 response');
    timeoutError.code = 'ETIMEDOUT';
    timeoutError.command = 'DATA';

    (etherealService.sendEmail as jest.Mock).mockRejectedValue(timeoutError);

    const job = createMockJob(emailId, 0);
    await (worker as any).processEmailJob(emailId, job);

    // Assert DB update: FAILED + deterministic Message-ID recorded
    expect(prisma.email.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: emailId },
        data: expect.objectContaining({
          status: EmailStatus.FAILED,
          messageId: '<reachflow-email-audit-metadata-test@salesforce.com>',
          error: expect.stringContaining('SMTP delivery outcome ambiguous'),
        }),
      })
    );

    // Assert audit event: DLQ_MOVED + rich metadata
    expect(prisma.emailEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          emailId,
          type: EventType.DLQ_MOVED,
          message: expect.stringContaining('delivery outcome unknown'),
          metadata: expect.objectContaining({
            error: 'Socket timed out waiting for server 250 response',
            deterministicMessageId: '<reachflow-email-audit-metadata-test@salesforce.com>',
            attemptsMade: 1,
            ambiguous: true,
            retrySuppressed: true,
          }),
        }),
      })
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 7: Unit classification test for isAmbiguousSmtpError across scenarios
  // ───────────────────────────────────────────────────────────────────────────
  describe('isAmbiguousSmtpError classification unit tests', () => {
    it('classifies pre-send errors as clear (false)', () => {
      // Connection refused
      expect(worker.isAmbiguousSmtpError({ code: 'ECONNREFUSED', message: 'connection refused' })).toBe(false);
      // DNS error
      expect(worker.isAmbiguousSmtpError({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND' })).toBe(false);
      // Pre-send timeout
      expect(worker.isAmbiguousSmtpError({ message: 'SMTP connection timeout' })).toBe(false);
      // Auth error
      expect(worker.isAmbiguousSmtpError({ code: 'EAUTH', responseCode: 535 })).toBe(false);
      // Envelope reject
      expect(worker.isAmbiguousSmtpError({ code: 'EENVELOPE', command: 'RCPT' })).toBe(false);
      // 550 User unknown
      expect(worker.isAmbiguousSmtpError({ responseCode: 550, message: '550 5.1.1 User unknown' })).toBe(false);
      // 503 Service unavailable
      expect(worker.isAmbiguousSmtpError({ responseCode: 503, message: '503 Service Unavailable' })).toBe(false);
    });

    it('classifies in-flight/post-transmission errors as ambiguous (true)', () => {
      // ECONNRESET
      expect(worker.isAmbiguousSmtpError({ code: 'ECONNRESET', message: 'read ECONNRESET' })).toBe(true);
      // Socket hang up
      expect(worker.isAmbiguousSmtpError({ message: 'socket hang up' })).toBe(true);
      // Broken pipe
      expect(worker.isAmbiguousSmtpError({ code: 'EPIPE', message: 'write EPIPE' })).toBe(true);
      // DATA command timeout
      expect(worker.isAmbiguousSmtpError({ command: 'DATA', code: 'ETIMEDOUT' })).toBe(true);
      // Transmission phase flag set
      expect(
        worker.isAmbiguousSmtpError(
          { code: 'ETIMEDOUT', message: 'Socket timeout waiting for 250 response' },
          true // transmissionStarted
        )
      ).toBe(true);
      // Post-transmission phase marker
      expect(worker.isAmbiguousSmtpError({ phase: 'transmission', message: 'connection closed' })).toBe(true);
    });
  });
});
