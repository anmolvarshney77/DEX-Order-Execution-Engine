import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OrderQueue } from './OrderQueue';
import { EnvironmentConfig } from '../config/env';
import { OrderJob } from '../types';

// Mock Redis client
vi.mock('../persistence/redis', () => ({
  getRedisClient: vi.fn(() => ({
    on: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    quit: vi.fn()
  }))
}));

// Mock logger
vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}));

describe('OrderQueue', () => {
  let orderQueue: OrderQueue;
  let mockConfig: EnvironmentConfig;

  beforeEach(() => {
    mockConfig = {
      QUEUE_CONCURRENCY: 10,
      QUEUE_MAX_RETRIES: 3,
      QUEUE_BACKOFF_DELAY: 1000,
      REDIS_HOST: 'localhost',
      REDIS_PORT: 6379,
      REDIS_DB: 0,
      REDIS_TTL: 3600
    } as EnvironmentConfig;

    orderQueue = new OrderQueue(mockConfig);
  });

  afterEach(async () => {
    await orderQueue.close();
  });

  describe('initialization', () => {
    it('should initialize with correct configuration', () => {
      const config = orderQueue.getConfig();
      
      expect(config.concurrency).toBe(10);
      expect(config.maxRetries).toBe(3);
      expect(config.backoffDelay).toBe(1000);
    });

    it('should create a BullMQ queue instance', () => {
      const queue = orderQueue.getQueue();
      
      expect(queue).toBeDefined();
      expect(queue.name).toBe('order-processing');
    });
  });

  describe('enqueue', () => {
    it('should enqueue an order job', async () => {
      const job: OrderJob = {
        orderId: 'test-order-1',
        tokenIn: 'TokenA',
        tokenOut: 'TokenB',
        amount: 1000,
        slippage: 0.01,
        attempt: 1
      };

      const jobId = await orderQueue.enqueue(job);
      
      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');
    });

    it('should use orderId as job ID for idempotency', async () => {
      const job: OrderJob = {
        orderId: 'test-order-2',
        tokenIn: 'TokenA',
        tokenOut: 'TokenB',
        amount: 1000,
        slippage: 0.01,
        attempt: 1
      };

      const jobId = await orderQueue.enqueue(job);
      
      expect(jobId).toBe(job.orderId);
    });

    it('should enqueue multiple orders', async () => {
      const jobs: OrderJob[] = [
        {
          orderId: 'order-1',
          tokenIn: 'TokenA',
          tokenOut: 'TokenB',
          amount: 1000,
          slippage: 0.01,
          attempt: 1
        },
        {
          orderId: 'order-2',
          tokenIn: 'TokenC',
          tokenOut: 'TokenD',
          amount: 2000,
          slippage: 0.02,
          attempt: 1
        }
      ];

      const jobIds = await Promise.all(jobs.map(job => orderQueue.enqueue(job)));
      
      expect(jobIds).toHaveLength(2);
      expect(jobIds[0]).toBe('order-1');
      expect(jobIds[1]).toBe('order-2');
    });
  });

  describe('queue metrics', () => {
    it('should return queue metrics', async () => {
      const metrics = await orderQueue.getMetrics();
      
      expect(metrics).toHaveProperty('waiting');
      expect(metrics).toHaveProperty('active');
      expect(metrics).toHaveProperty('completed');
      expect(metrics).toHaveProperty('failed');
      expect(metrics).toHaveProperty('delayed');
      expect(metrics).toHaveProperty('total');
    });
  });

  describe('queue control', () => {
    it('should pause the queue', async () => {
      await expect(orderQueue.pause()).resolves.not.toThrow();
    });

    it('should resume the queue', async () => {
      await orderQueue.pause();
      await expect(orderQueue.resume()).resolves.not.toThrow();
    });

    it('should drain the queue', async () => {
      await expect(orderQueue.drain()).resolves.not.toThrow();
    });
  });
});
