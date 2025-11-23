import Redis from 'ioredis';
import { loadConfig } from '../config/env.js';

let redis: Redis | null = null;

/**
 * Get or create Redis client
 */
export function getRedisClient(): Redis {
  if (!redis) {
    const config = loadConfig();
    
    redis = new Redis({
      host: config.REDIS_HOST,
      port: config.REDIS_PORT,
      password: config.REDIS_PASSWORD,
      db: config.REDIS_DB,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      // BullMQ requires maxRetriesPerRequest to be null for blocking operations
      maxRetriesPerRequest: null,
    });

    redis.on('error', (err) => {
      console.error('Redis client error:', err);
    });

    redis.on('connect', () => {
      console.log('Redis client connected');
    });
  }

  return redis;
}

/**
 * Close Redis connection
 */
export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

/**
 * Test Redis connection
 */
export async function testRedisConnection(): Promise<boolean> {
  try {
    const client = getRedisClient();
    await client.ping();
    return true;
  } catch (error) {
    console.error('Redis connection test failed:', error);
    return false;
  }
}
