/**
 * F6 Campaign vs Sender Hourly Limit Tests
 *
 * Verifies effective hourly limit calculation:
 * effectiveHourlyLimit = Math.min(
 *   email.sender?.hourlyLimit ?? config.defaultMaxEmailsPerHour,
 *   email.campaign?.hourlyLimit ?? email.sender?.hourlyLimit ?? config.defaultMaxEmailsPerHour
 * )
 *
 * Tests:
 * 1. campaign 20 / sender 100 -> 20
 * 2. campaign 100 / sender 30 -> 30
 * 3. both 50 -> 50
 * 4. missing campaign limit -> sender limit
 * 5. rate-limit event + Slack use effective limit
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
  etherealService: {
    sendEmail: jest.fn().mockResolvedValue({
      messageId: '<msg-f6-test@reachflow.io>',
      response: '250 OK: queued as 12345',
      accepted: ['lead@target.com'],
      rejected: [],
    }),
  },
}));

jest.mock('../src/services/slack', () => ({
  slackService: { sendDeduplicatedRateLimitAlert: jest.fn().mockResolvedValue(undefined) },
}));

import { EmailStatus, EventType } from '@reachflow/shared';
import { Job } from 'bullmq';
import { EmailJobData } from '../src/queues/emailQueue';
import { prisma } from '../src/prisma/client';
import { rateLimiterService } from '../src/services/rateLimiter';
import { slackService } from '../src/services/slack';
import { EmailWorkerService } from '../src/workers/emailWorker';

describe('F6 — Campaign vs Sender Hourly Limit', () => {
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
    senderHourlyLimit?: number | null;
    campaignHourlyLimit?: number | null;
    status?: string;
  }) => ({
    id: options.emailId,
    status: options.status ?? EmailStatus.SCHEDULED,
    attempts: 0,
    scheduledAt: new Date(),
    senderId: 'sender-1',
    sender: {
      id: 'sender-1',
      email: 'sender@reachflow.io',
      name: 'Sales Rep',
      hourlyLimit: options.senderHourlyLimit,
      etherealUser: 'ethereal_user',
      etherealPass: 'ethereal_pass',
    },
    campaignId: 'camp-1',
    campaign: {
      id: 'camp-1',
      name: 'Outreach Q1',
      delayMs: 1,
      hourlyLimit: options.campaignHourlyLimit,
    },
    userId: 'user-1',
    user: {},
    recipient: 'lead@target.com',
    subject: 'Quick question',
    body: 'Would love to connect.',
    updatedAt: new Date(),
  });

  const createMockJob = (emailId: string) =>
    ({
      id: `email-send-${emailId}`,
      data: { emailId },
      opts: { attempts: 3 },
      attemptsMade: 0,
    } as Job<EmailJobData>);

  const makeTxClient = () => ({
    email: { updateMany: prisma.email.updateMany, update: prisma.email.update },
    campaign: { update: prisma.campaign.update },
    emailEvent: { create: prisma.emailEvent.create },
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 1: campaign 20 / sender 100 → effective limit 20
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 1: campaign 20 / sender 100 -> checks rate limit with 20', async () => {
    const emailId = 'f6-test1-camp20-sender100';
    const email = createMockEmail({
      emailId,
      campaignHourlyLimit: 20,
      senderHourlyLimit: 100,
    });

    (prisma.email.findUnique as jest.Mock).mockResolvedValue(email);
    (prisma.email.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.emailEvent.create as jest.Mock).mockResolvedValue({});
    (prisma.campaign.update as jest.Mock).mockResolvedValue({});
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: any) =>
      typeof arg === 'function' ? arg(makeTxClient()) : Promise.all(arg)
    );

    (rateLimiterService.checkAndIncrement as jest.Mock).mockResolvedValue({
      allowed: true,
      currentCount: 5,
      windowKey: 'rate:sender-1',
      resetTimeMs: Date.now() + 3_600_000,
    });

    const job = createMockJob(emailId);
    await (worker as any).processEmailJob(emailId, job);

    expect(rateLimiterService.checkAndIncrement).toHaveBeenCalledWith('sender-1', 20);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 2: campaign 100 / sender 30 → effective limit 30
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 2: campaign 100 / sender 30 -> checks rate limit with 30', async () => {
    const emailId = 'f6-test2-camp100-sender30';
    const email = createMockEmail({
      emailId,
      campaignHourlyLimit: 100,
      senderHourlyLimit: 30,
    });

    (prisma.email.findUnique as jest.Mock).mockResolvedValue(email);
    (prisma.email.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.emailEvent.create as jest.Mock).mockResolvedValue({});
    (prisma.campaign.update as jest.Mock).mockResolvedValue({});
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: any) =>
      typeof arg === 'function' ? arg(makeTxClient()) : Promise.all(arg)
    );

    (rateLimiterService.checkAndIncrement as jest.Mock).mockResolvedValue({
      allowed: true,
      currentCount: 5,
      windowKey: 'rate:sender-1',
      resetTimeMs: Date.now() + 3_600_000,
    });

    const job = createMockJob(emailId);
    await (worker as any).processEmailJob(emailId, job);

    expect(rateLimiterService.checkAndIncrement).toHaveBeenCalledWith('sender-1', 30);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 3: both 50 → effective limit 50
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 3: both 50 -> checks rate limit with 50', async () => {
    const emailId = 'f6-test3-camp50-sender50';
    const email = createMockEmail({
      emailId,
      campaignHourlyLimit: 50,
      senderHourlyLimit: 50,
    });

    (prisma.email.findUnique as jest.Mock).mockResolvedValue(email);
    (prisma.email.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.emailEvent.create as jest.Mock).mockResolvedValue({});
    (prisma.campaign.update as jest.Mock).mockResolvedValue({});
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: any) =>
      typeof arg === 'function' ? arg(makeTxClient()) : Promise.all(arg)
    );

    (rateLimiterService.checkAndIncrement as jest.Mock).mockResolvedValue({
      allowed: true,
      currentCount: 5,
      windowKey: 'rate:sender-1',
      resetTimeMs: Date.now() + 3_600_000,
    });

    const job = createMockJob(emailId);
    await (worker as any).processEmailJob(emailId, job);

    expect(rateLimiterService.checkAndIncrement).toHaveBeenCalledWith('sender-1', 50);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 4: missing campaign limit → sender limit
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 4: missing campaign limit -> falls back to sender limit', async () => {
    const emailId = 'f6-test4-camp-missing-sender40';
    const email = createMockEmail({
      emailId,
      campaignHourlyLimit: undefined,
      senderHourlyLimit: 40,
    });

    (prisma.email.findUnique as jest.Mock).mockResolvedValue(email);
    (prisma.email.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.emailEvent.create as jest.Mock).mockResolvedValue({});
    (prisma.campaign.update as jest.Mock).mockResolvedValue({});
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: any) =>
      typeof arg === 'function' ? arg(makeTxClient()) : Promise.all(arg)
    );

    (rateLimiterService.checkAndIncrement as jest.Mock).mockResolvedValue({
      allowed: true,
      currentCount: 5,
      windowKey: 'rate:sender-1',
      resetTimeMs: Date.now() + 3_600_000,
    });

    const job = createMockJob(emailId);
    await (worker as any).processEmailJob(emailId, job);

    expect(rateLimiterService.checkAndIncrement).toHaveBeenCalledWith('sender-1', 40);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 5: rate-limit event + Slack use effective limit
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 5: rate-limit event + Slack use effective limit when limit is exceeded', async () => {
    const emailId = 'f6-test5-exceeded-effective-limit';
    // Campaign limit 25 is lower than sender limit 100 -> effective is 25
    const email = createMockEmail({
      emailId,
      campaignHourlyLimit: 25,
      senderHourlyLimit: 100,
    });

    (prisma.email.findUnique as jest.Mock).mockResolvedValue(email);
    (prisma.email.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.emailEvent.create as jest.Mock).mockResolvedValue({});
    (prisma.email.update as jest.Mock).mockResolvedValue({});
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: any) => {
      if (typeof arg === 'function') {
        return arg(makeTxClient());
      }
      return Promise.all(arg);
    });

    const resetTimeMs = Date.now() + 3_600_000;
    (rateLimiterService.checkAndIncrement as jest.Mock).mockResolvedValue({
      allowed: false,
      currentCount: 25,
      windowKey: 'rate:sender-1',
      resetTimeMs,
    });

    const job = createMockJob(emailId);
    await (worker as any).processEmailJob(emailId, job);

    // 1. checkAndIncrement checked with effective limit 25
    expect(rateLimiterService.checkAndIncrement).toHaveBeenCalledWith('sender-1', 25);

    // 2. Slack alert payload uses effective limit 25
    expect(slackService.sendDeduplicatedRateLimitAlert).toHaveBeenCalledWith(
      'user-1',
      'sender-1',
      expect.objectContaining({
        hourlyLimit: 25,
        currentCount: 25,
      })
    );

    // 3. RATE_LIMIT_EXCEEDED event message contains effective limit (25/25)
    expect(prisma.emailEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: EventType.RATE_LIMIT_EXCEEDED,
          message: expect.stringContaining('(25/25)'),
        }),
      })
    );
  });
});
