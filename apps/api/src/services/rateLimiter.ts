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

// Lua script for per-sender serialized inter-send start interval
// Guarantees minimum interval between SMTP dispatch start times per sender across concurrent workers
const RESERVE_SENDER_INTERVAL_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local delay = tonumber(ARGV[2])

local current_allowed = tonumber(redis.call('get', key) or "0")
local scheduled_time = current_allowed
if scheduled_time < now then
    scheduled_time = now
end

local next_time = scheduled_time + delay
redis.call('set', key, next_time, 'EX', math.ceil(delay * 10 / 1000) + 60)

return scheduled_time
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
   * Enforces minimum interval between dispatch start times for a sender across concurrent workers
   */
  public async reserveSendSlot(senderId: string, delayMs: number): Promise<number> {
    const nowMs = Date.now();
    const redisKey = `reachflow:throttle:sender:${senderId}:next_send_time`;

    const scheduledTime = (await redisClient.eval(
      RESERVE_SENDER_INTERVAL_LUA,
      1,
      redisKey,
      nowMs.toString(),
      delayMs.toString()
    )) as number;

    const waitMs = scheduledTime - nowMs;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
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
