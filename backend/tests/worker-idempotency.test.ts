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

jest.mock('../src/queues/redis', () => ({ redisConnectionOptions: {} }));
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
  etherealService: { sendEmail: jest.fn().mockResolvedValue({ messageId: 'test-message' }) },
}));
jest.mock('../src/services/slack', () => ({ slackService: { sendDeduplicatedRateLimitAlert: jest.fn() } }));

import { EmailStatus } from '@reachflow/shared';
import { Job } from 'bullmq';
import { EmailJobData } from '../src/queues/emailQueue';
import { prisma } from '../src/prisma/client';
import { etherealService } from '../src/services/ethereal';
import { EmailWorkerService } from '../src/workers/emailWorker';

describe('Email worker idempotency', () => {
  it('allows only one concurrent execution to claim and send an email', async () => {
    const emailId = 'email-idempotency-test';
    const email = {
      id: emailId,
      status: EmailStatus.SCHEDULED,
      attempts: 0,
      senderId: 'sender-id',
      sender: {
        id: 'sender-id',
        email: 'sender@example.com',
        name: 'Sender',
        hourlyLimit: 10,
        etherealUser: 'user',
        etherealPass: 'pass',
      },
      campaignId: 'campaign-id',
      campaign: { id: 'campaign-id', name: 'Campaign', delayMs: 1 },
      userId: 'user-id',
      user: {},
      recipient: 'recipient@example.com',
      subject: 'Hello',
      body: 'Test message',
    };

    (prisma.email.findUnique as jest.Mock).mockResolvedValue(email);
    (prisma.email.updateMany as jest.Mock).mockImplementation(async ({ where, data }) => {
      if (where.status?.in && !where.status.in.includes(email.status)) {
        return { count: 0 };
      }
      if (where.status?.not && where.status.not === email.status) {
        return { count: 0 };
      }
      email.status = data.status;
      return { count: 1 };
    });
    (prisma.email.update as jest.Mock).mockResolvedValue({});
    (prisma.emailEvent.create as jest.Mock).mockResolvedValue({});
    (prisma.campaign.update as jest.Mock).mockResolvedValue({});

    const transactionClient = {
      email: { updateMany: prisma.email.updateMany },
      campaign: { update: prisma.campaign.update },
      emailEvent: { create: prisma.emailEvent.create },
    };
    (prisma.$transaction as jest.Mock).mockImplementation(async (operation) =>
      Array.isArray(operation) ? Promise.all(operation) : operation(transactionClient)
    );

    const job = {
      id: `email-send-${emailId}`,
      data: { emailId },
      opts: { attempts: 3 },
      attemptsMade: 0,
    } as Job<EmailJobData>;
    const worker = new EmailWorkerService();

    await Promise.all([
      (worker as any).processEmailJob(emailId, job),
      (worker as any).processEmailJob(emailId, job),
    ]);

    // Winner claims (1) + winner finalizes (1); concurrent worker detects active lease in PROCESSING and skips safely
    expect(prisma.email.updateMany).toHaveBeenCalledTimes(2);
    expect(etherealService.sendEmail).toHaveBeenCalledTimes(1);

    // F3 recovery check: concurrent worker schedules recovery with a valid finite delay (never NaN)
    const { emailQueue } = await import('../src/queues/emailQueue');
    const recoveryCall = (emailQueue.add as jest.Mock).mock.calls.find(
      (call: any[]) => call[1]?.isRecovery
    );
    expect(recoveryCall).toBeDefined();
    expect(Number.isFinite(recoveryCall[2]?.delay)).toBe(true);
    expect(Number.isNaN(recoveryCall[2]?.delay)).toBe(false);
  });
});