import { Queue, QueueOptions } from 'bullmq';
import { getRedisClient } from '../persistence/redis';
import { OrderJob } from '../types';
import { logger } from '../utils/logger';
import { EnvironmentConfig } from '../config/env';

/**
 * Configuration for OrderQueue
 */
export interface OrderQueueConfig {
  concurrency: number;
  maxRetries: number;
  backoffDelay: number;
}

/**
 * OrderQueue manages order processing with BullMQ
 * Handles job enqueueing with retry configuration
 * 
 * Requirements: 4.1, 4.3, 4.4, 4.5
 */
export class OrderQueue {
  private readonly queue: Queue<OrderJob>;
  private readonly config: OrderQueueConfig;

  constructor(config: EnvironmentConfig) {
    this.config = {
      concurrency: config.QUEUE_CONCURRENCY,
      maxRetries: config.QUEUE_MAX_RETRIES,
      backoffDelay: config.QUEUE_BACKOFF_DELAY
    };

    // Get Redis connection for BullMQ
    const connection = getRedisClient();

    // Configure BullMQ queue options
    const queueOptions: QueueOptions = {
      connection,
      defaultJobOptions: {
        // Requirement 4.3: Retry with exponential back-off
        attempts: this.config.maxRetries,
        backoff: {
          type: 'exponential',
          delay: this.config.backoffDelay
        },
        // Remove completed jobs after 24 hours
        removeOnComplete: {
          age: 86400, // 24 hours in seconds
          count: 1000 // Keep last 1000 completed jobs
        },
        // Remove failed jobs after 7 days
        removeOnFail: {
          age: 604800, // 7 days in seconds
          count: 5000 // Keep last 5000 failed jobs
        }
      }
    };

    this.queue = new Queue<OrderJob>('order-processing', queueOptions);

    logger.info({
      concurrency: this.config.concurrency,
      maxRetries: this.config.maxRetries,
      backoffDelay: this.config.backoffDelay
    }, 'OrderQueue initialized');
  }

  /**
   * Add an order to the queue for processing
   * Requirement 1.4: Add order to queue with status "pending"
   * Requirement 4.5: Process orders in FIFO order
   * 
   * @param job - Order job data
   * @returns Job ID
   */
  async enqueue(job: OrderJob): Promise<string> {
    logger.info({
      orderId: job.orderId,
      tokenIn: job.tokenIn,
      tokenOut: job.tokenOut,
      amount: job.amount,
      slippage: job.slippage
    }, 'Enqueueing order');

    // Add job to queue with FIFO ordering (default behavior)
    const bullJob = await this.queue.add(
      `order-${job.orderId}`,
      job,
      {
        jobId: job.orderId, // Use orderId as job ID for idempotency
        priority: 0 // FIFO: all jobs have same priority
      }
    );

    logger.info({
      orderId: job.orderId,
      jobId: bullJob.id
    }, 'Order enqueued successfully');

    return bullJob.id!;
  }

  /**
   * Get the queue instance for worker attachment
   * @returns BullMQ Queue instance
   */
  getQueue(): Queue<OrderJob> {
    return this.queue;
  }

  /**
   * Get queue configuration
   * @returns Queue configuration
   */
  getConfig(): OrderQueueConfig {
    return this.config;
  }

  /**
   * Get queue metrics
   * @returns Queue metrics including counts
   */
  async getMetrics() {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount()
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + completed + failed + delayed
    };
  }

  /**
   * Close the queue connection
   */
  async close(): Promise<void> {
    await this.queue.close();
    logger.info('OrderQueue closed');
  }

  /**
   * Pause the queue (stop processing new jobs)
   */
  async pause(): Promise<void> {
    await this.queue.pause();
    logger.info('OrderQueue paused');
  }

  /**
   * Resume the queue (start processing jobs again)
   */
  async resume(): Promise<void> {
    await this.queue.resume();
    logger.info('OrderQueue resumed');
  }

  /**
   * Drain the queue (remove all waiting jobs)
   */
  async drain(): Promise<void> {
    await this.queue.drain();
    logger.info('OrderQueue drained');
  }
}
