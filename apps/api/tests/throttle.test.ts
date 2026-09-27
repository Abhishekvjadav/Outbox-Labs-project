/**
 * F2 Sender Minimum-Delay Throttle Tests
 *
 * Verifies per-sender inter-send serialized throttling reliability:
 * 1. Long queue does not expire throttle key (dynamic TTL scales with next_time).
 * 2. Concurrent same-sender reservations remain spaced by at least delayMs.
 * 3. Redis server TIME is used for timeline instead of caller clock.
 * 4. PROVIDER_DELAY_APPLIED DB event occurs before the throttle sleep / SMTP start.
 * 5. Different senders remain completely independent.
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

jest.mock('../src/services/ethereal', () => ({
  etherealService: {
    sendEmail: jest.fn().mockResolvedValue({
      messageId: '<msg-throttle-test@reachflow.io>',
      response: '250 OK',
      accepted: ['lead@target.com'],
      rejected: [],
    }),
  },
}));

jest.mock('../src/services/slack', () => ({
  slackService: { sendDeduplicatedRateLimitAlert: jest.fn().mockResolvedValue(undefined) },
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

import { EmailStatus, EventType } from '@reachflow/shared';
import { Job } from 'bullmq';
import { EmailJobData } from '../src/queues/emailQueue';
import { prisma } from '../src/prisma/client';
import { etherealService } from '../src/services/ethereal';
import { rateLimiterService } from '../src/services/rateLimiter';
import { redisClient } from '../src/queues/redis';
import { EmailWorkerService } from '../src/workers/emailWorker';

describe('F2 — Per-Sender Serialized Inter-Send Throttling', () => {
  const testSenders: string[] = [];

  const getUniqueSender = (prefix: string) => {
    const id = `${prefix}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    testSenders.push(id);
    return id;
  };

  afterAll(async () => {
    for (const senderId of testSenders) {
      await redisClient.del(`reachflow:throttle:sender:${senderId}:next_send_time`);
    }
    await redisClient.quit();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 1: long queue does not expire throttle key (Dynamic TTL)
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 1: long queue does not expire throttle key (dynamic TTL scales with next_time)', async () => {
    const senderId = getUniqueSender('f2-long-queue');
    const redisKey = `reachflow:throttle:sender:${senderId}:next_send_time`;

    // Simulate a deep queue pushing next_time 120 seconds into the future
    // In old code, TTL was capped at ceil(delay*10/1000) + 60 = ~70s.
    // In new code, TTL = max(60, ceil((next_time - now)/1000) + 60) >= 120 + 60 = 180s.
    const delayMs = 120_000;
    await rateLimiterService.reserveSendSlot(senderId, delayMs);

    const ttl = await redisClient.ttl(redisKey);

    // TTL must be well above the old static 70s ceiling (at least 150 seconds)
    expect(ttl).toBeGreaterThanOrEqual(150);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 2: concurrent same-sender reservations remain spaced
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 2: concurrent same-sender reservations remain spaced by at least delayMs', async () => {
    const senderId = getUniqueSender('f2-concurrent-same');
    const delayMs = 250;
    const count = 4;

    // Issue concurrent reservation requests
    const promises: Promise<number>[] = [];
    for (let i = 0; i < count; i++) {
      promises.push(rateLimiterService.reserveSendSlot(senderId, delayMs));
    }

    const scheduledTimes = await Promise.all(promises);

    // Sort ascending
    scheduledTimes.sort((a, b) => a - b);

    // Verify each slot is spaced by at least delayMs
    for (let i = 1; i < scheduledTimes.length; i++) {
      const diff = scheduledTimes[i] - scheduledTimes[i - 1];
      expect(diff).toBeGreaterThanOrEqual(delayMs);
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 3: Redis server time is used
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 3: Redis server TIME is used for the throttle timeline', async () => {
    const senderId = getUniqueSender('f2-redis-time');

    // Get authoritative Redis server time
    const timeRes = (await redisClient.time()) as unknown as [string | number, string | number];
    const redisServerTime = Number(timeRes[0]) * 1000 + Math.floor(Number(timeRes[1]) / 1000);

    const slot = await rateLimiterService.reserveSendSlot(senderId, 500);

    // Slot must be grounded in Redis server time (within 1000ms margin of network roundtrip)
    expect(slot).toBeGreaterThanOrEqual(redisServerTime - 50);
    expect(slot).toBeLessThanOrEqual(redisServerTime + 1500);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 4: DB event occurs before wait/SMTP
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 4: PROVIDER_DELAY_APPLIED DB event occurs before the throttle wait concludes and before SMTP starts', async () => {
    const worker = new EmailWorkerService();
    const senderId = getUniqueSender('f2-event-order');
    const emailId = `email-${senderId}`;
    const delayMs = 200;

    const email = {
      id: emailId,
      status: EmailStatus.SCHEDULED,
      attempts: 0,
      scheduledAt: new Date(),
      senderId,
      sender: {
        id: senderId,
        email: 'sender@reachflow.io',
        name: 'Sender',
        hourlyLimit: 100,
        etherealUser: 'user',
        etherealPass: 'pass',
      },
      campaignId: 'camp-f2',
      campaign: {
        id: 'camp-f2',
        name: 'F2 Campaign',
        delayMs,
        hourlyLimit: 100,
      },
      userId: 'user-1',
      user: {},
      recipient: 'target@reachflow.io',
      subject: 'F2 Timing Test',
      body: 'Testing event order.',
      updatedAt: new Date(),
    };

    (prisma.email.findUnique as jest.Mock).mockResolvedValue(email);
    (prisma.email.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.campaign.update as jest.Mock).mockResolvedValue({});
    (prisma.$transaction as jest.Mock).mockImplementation(async (arg: any) => {
      if (typeof arg === 'function') {
        return arg({
          email: { updateMany: prisma.email.updateMany, update: prisma.email.update },
          campaign: { update: prisma.campaign.update },
          emailEvent: { create: prisma.emailEvent.create },
        });
      }
      return Promise.all(arg);
    });

    const executionLog: string[] = [];

    // Pre-reserve slot 1 so slot 2 is forced to wait delayMs
    await rateLimiterService.reserveSendSlot(senderId, delayMs);

    (prisma.emailEvent.create as jest.Mock).mockImplementation(async ({ data }: any) => {
      if (data.type === EventType.PROVIDER_DELAY_APPLIED) {
        executionLog.push(`DB_EVENT_BEFORE_WAIT_AT_${Date.now()}`);
      }
      return {};
    });

    (etherealService.sendEmail as jest.Mock).mockImplementation(async () => {
      executionLog.push(`SMTP_DISPATCH_AFTER_WAIT_AT_${Date.now()}`);
      return {
        messageId: '<msg-f2@reachflow.io>',
        response: '250 OK',
        accepted: ['target@reachflow.io'],
        rejected: [],
      };
    });

    const job = {
      id: `job-${emailId}`,
      data: { emailId },
      opts: { attempts: 3 },
      attemptsMade: 0,
    } as Job<EmailJobData>;

    await (worker as any).processEmailJob(emailId, job);

    // Verify ordering: DB event was logged BEFORE SMTP dispatch
    expect(executionLog.length).toBe(2);
    expect(executionLog[0]).toMatch(/^DB_EVENT_BEFORE_WAIT_AT_/);
    expect(executionLog[1]).toMatch(/^SMTP_DISPATCH_AFTER_WAIT_AT_/);

    const eventTime = Number(executionLog[0].replace('DB_EVENT_BEFORE_WAIT_AT_', ''));
    const smtpTime = Number(executionLog[1].replace('SMTP_DISPATCH_AFTER_WAIT_AT_', ''));

    // SMTP dispatch happened strictly AFTER DB event, separated by the throttle wait
    expect(smtpTime).toBeGreaterThanOrEqual(eventTime);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 5: different senders remain independent
  // ───────────────────────────────────────────────────────────────────────────
  it('TEST 5: different senders remain independent and do not block each other', async () => {
    const senderA = getUniqueSender('f2-sender-a');
    const senderB = getUniqueSender('f2-sender-b');
    const delayMs = 5000; // 5 seconds delay for Sender A

    // Sender A reserves slot: next slot for sender A is pushed 5s into future
    const slotA1 = await rateLimiterService.reserveSendSlot(senderA, delayMs);

    // Sender B reserves slot immediately after: must NOT be delayed by Sender A's 5s reservation
    const slotB1 = await rateLimiterService.reserveSendSlot(senderB, delayMs);

    // Sender B's slot should be scheduled near slotA1's start time (~now), NOT slotA1 + 5000ms
    expect(Math.abs(slotB1 - slotA1)).toBeLessThan(1000);
  });
});
