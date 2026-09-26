import Redis, { RedisOptions } from 'ioredis';
import { config } from '../config/env';

export const redisConnectionOptions: RedisOptions = {
  host: config.redisHost,
  port: config.redisPort,
  password: config.redisPassword,
  tls: config.redisTls ? {} : undefined,
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: false,
  retryStrategy: (times) => {
    const delay = Math.min(times * 100, 3000);
    return delay;
  },
};

export const redisClient = new Redis(redisConnectionOptions);

redisClient.on('connect', () => {
  console.log(`[Redis] Connected to ${config.redisHost}:${config.redisPort}`);
});

redisClient.on('error', (err) => {
  console.error('[Redis] Connection error:', err.message);
});
