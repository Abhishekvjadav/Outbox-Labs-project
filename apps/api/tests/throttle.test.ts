import { rateLimiterService } from '../src/services/rateLimiter';
import { redisClient } from '../src/queues/redis';

describe('Per-Sender Serialized Inter-Send Throttling', () => {
  const senderId = `sender-throttle-${Date.now()}`;
  const delayMs = 500;

  afterAll(async () => {
    await redisClient.del(`reachflow:throttle:sender:${senderId}:next_send_time`);
    await redisClient.quit();
  });

  it('guarantees that dispatch start times for the same sender are spaced by at least delayMs across workers', async () => {
    const t0 = Date.now();
    const slot1 = await rateLimiterService.reserveSendSlot(senderId, delayMs);
    const slot2 = await rateLimiterService.reserveSendSlot(senderId, delayMs);

    expect(slot1).toBeGreaterThanOrEqual(t0);
    expect(slot2).toBeGreaterThanOrEqual(slot1 + delayMs);
  });
});
