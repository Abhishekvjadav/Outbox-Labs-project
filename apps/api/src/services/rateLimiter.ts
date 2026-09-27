import { redisClient } from '../queues/redis';

// Lua script for atomic check-and-increment hourly rate limiter
// Strictly prevents counter overrun under concurrent worker load
const CHECK_AND_INCR_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])

local current = tonumber(redis.call('get', key) or "0")
if current >= limit then
    -- Rejected: sender limit already reached
    return {0, current}
else
    -- Allowed: increment and set TTL if new key
    local new_val = redis.call('incr', key)
    if new_val == 1 then
        redis.call('expire', key, ttl)
    end
    return {1, new_val}
end
`;

// Lua script for atomic rate limit quota compensation (decrement with floor of 0)
// Restores quota when an SMTP delivery attempt fails before acceptance
const COMPENSATE_QUOTA_LUA = `
local key = KEYS[1]
local current = tonumber(redis.call('get', key) or "0")
if current > 0 then
    local new_val = redis.call('decr', key)
    if new_val < 0 then
        redis.call('set', key, "0")
        return 0
    end
    return new_val
else
    return 0
end
`;

// Lua script for per-sender serialized inter-send start interval
// Guarantees minimum interval between SMTP dispatch start times per sender across concurrent workers
const RESERVE_SENDER_INTERVAL_LUA = `
local key = KEYS[1]
local delay = tonumber(ARGV[2] or ARGV[1])

local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)

local current_allowed = tonumber(redis.call('get', key) or "0")
local scheduled_time = current_allowed
if scheduled_time < now then
    scheduled_time = now
end

local next_time = scheduled_time + delay
local ttl = math.max(60, math.ceil((next_time - now) / 1000) + 60)
redis.call('set', key, next_time, 'EX', ttl)

local wait_ms = scheduled_time - now
if wait_ms < 0 then
    wait_ms = 0
end

return {scheduled_time, wait_ms}
`;

export interface RateLimitCheckResult {
  allowed: boolean;
  currentCount: number;
  limit: number;
  resetTimeMs: number;
  windowKey: string;
}

export class RateLimiterService {
  /**
   * Generates the UTC hourly window key (e.g. "2026-09-26-18")
   */
  public static getHourlyWindowKey(date: Date = new Date()): {
    windowKey: string;
    ttlSeconds: number;
    nextWindowStartMs: number;
  } {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hour = String(date.getUTCHours()).padStart(2, '0');
    const windowKey = `${year}-${month}-${day}-${hour}`;

    // Calculate exact start of the next hour
    const nextHour = new Date(Date.UTC(year, date.getUTCMonth(), date.getUTCDate(), date.getUTCHours() + 1, 0, 0, 0));
    const nowMs = date.getTime();
    const ttlSeconds = Math.max(1, Math.ceil((nextHour.getTime() - nowMs) / 1000));

    return {
      windowKey,
      ttlSeconds,
      nextWindowStartMs: nextHour.getTime(),
    };
  }

  /**
   * Atomically checks and increments hourly rate limit for a specific sender
   */
  public async checkAndIncrement(senderId: string, hourlyLimit: number): Promise<RateLimitCheckResult> {
    const now = new Date();
    const { windowKey, ttlSeconds, nextWindowStartMs } = RateLimiterService.getHourlyWindowKey(now);
    const redisKey = `reachflow:ratelimit:sender:${senderId}:window:${windowKey}`;

    // Execute atomic Lua script
    const result = (await redisClient.eval(
      CHECK_AND_INCR_LUA,
      1,
      redisKey,
      hourlyLimit.toString(),
      ttlSeconds.toString()
    )) as [number, number];

    const allowed = result[0] === 1;
    const currentCount = result[1];

    return {
      allowed,
      currentCount,
      limit: hourlyLimit,
      resetTimeMs: nextWindowStartMs + 1000, // 1 sec into next window
      windowKey,
    };
  }

  /**
   * Atomically compensates/decrements rate limit quota for a sender in a specific window.
   * Restores quota when an SMTP delivery attempt fails before acceptance.
   * Clamped at a floor of 0.
   */
  public async compensate(senderId: string, windowKey: string): Promise<number> {
    const redisKey = `reachflow:ratelimit:sender:${senderId}:window:${windowKey}`;
    try {
      const result = (await redisClient.eval(
        COMPENSATE_QUOTA_LUA,
        1,
        redisKey
      )) as number;
      return typeof result === 'number' ? result : 0;
    } catch (err) {
      console.warn(
        `[RateLimiterService] Failed to compensate quota for sender ${senderId} in window ${windowKey}:`,
        (err as Error).message
      );
      return 0;
    }
  }

  /**
   * Enforces minimum interval between dispatch start times for a sender across concurrent workers.
   * Uses Redis server TIME for timeline and dynamic TTL to prevent queue expiration.
   * Accepts an optional beforeSleep callback to perform operations (like DB logging) before sleeping.
   */
  public async reserveSendSlot(
    senderId: string,
    delayMs: number,
    beforeSleep?: (scheduledTime: number, waitMs: number) => Promise<void> | void
  ): Promise<number> {
    const redisKey = `reachflow:throttle:sender:${senderId}:next_send_time`;

    const result = (await redisClient.eval(
      RESERVE_SENDER_INTERVAL_LUA,
      1,
      redisKey,
      delayMs.toString()
    )) as [number, number] | number;

    const scheduledTime = Array.isArray(result) ? Number(result[0]) : Number(result);
    const initialWaitMs = Array.isArray(result) ? Number(result[1]) : Math.max(0, scheduledTime - Date.now());

    const startWaitMs = Date.now();
    if (beforeSleep) {
      await beforeSleep(scheduledTime, initialWaitMs);
    }
    const elapsedInCallback = Date.now() - startWaitMs;
    const remainingWaitMs = Math.max(0, initialWaitMs - elapsedInCallback);

    if (remainingWaitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, remainingWaitMs));
    }

    return scheduledTime;
  }

  /**
   * Returns current count in the active window for telemetry and UI
   */
  public async getCurrentUsage(senderId: string): Promise<number> {
    const { windowKey } = RateLimiterService.getHourlyWindowKey();
    const redisKey = `reachflow:ratelimit:sender:${senderId}:window:${windowKey}`;
    const val = await redisClient.get(redisKey);
    return val ? parseInt(val, 10) : 0;
  }
}

export const rateLimiterService = new RateLimiterService();
