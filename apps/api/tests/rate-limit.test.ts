import { rateLimiterService, RateLimiterService } from '../src/services/rateLimiter';
import { redisClient } from '../src/queues/redis';

describe('Atomic Redis Lua Rate Limiter', () => {
  const testSenderId = `test-sender-${Date.now()}`;
  const limit = 5;

  afterAll(async () => {
    const { windowKey } = RateLimiterService.getHourlyWindowKey();
    await redisClient.del(`reachflow:ratelimit:sender:${testSenderId}:window:${windowKey}`);
    await redisClient.quit();
  });

  it('allows sends up to the exact hourly limit and atomically rejects further requests', async () => {
    const results = [];

    // Simulate 10 requests under high concurrency
    for (let i = 0; i < 10; i++) {
      results.push(rateLimiterService.checkAndIncrement(testSenderId, limit));
    }

    const resolved = await Promise.all(results);

    const allowed = resolved.filter((r) => r.allowed);
    const rejected = resolved.filter((r) => !r.allowed);

    // Exactly 5 allowed, exactly 5 rejected
    expect(allowed.length).toBe(limit);
    expect(rejected.length).toBe(5);

    // Verify counter in Redis never exceeded the limit
    const currentUsage = await rateLimiterService.getCurrentUsage(testSenderId);
    expect(currentUsage).toBe(limit);

    // Verify rejected responses have a future resetTimeMs
    for (const r of rejected) {
      expect(r.resetTimeMs).toBeGreaterThan(Date.now());
    }
  });
});
