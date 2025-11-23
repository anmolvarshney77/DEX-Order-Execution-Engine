import { Worker, Job, WorkerOptions } from 'bullmq';
import { getRedisClient } from '../persistence/redis';
import { OrderJob, OrderRecord } from '../types';
import { DexRouter } from '../routing/DexRouter';
import { OrderExecutor } from '../execution/OrderExecutor';
import { OrderRepository } from '../persistence/OrderRepository';
import { OrderCache } from '../persistence/OrderCache';
import { logger } from '../utils/logger';
import { EnvironmentConfig } from '../config/env';
import { 
  withRetry, 
  classifyError, 
  errorEmitter, 
  isCriticalError
} from '../errors';

/**
 * Result of order processing
 */
export interface OrderResult {
  orderId: string;
  status: 'confirmed' | 'failed';
  txHash?: string;
  executedPrice?: number;
  error?: string;
}

/**
 * OrderProcessor handles the processing of orders from the queue
 * Implements process, onCompleted, and onFailed handlers
 * 
 * Requirements: 4.1, 4.3, 4.4, 4.5
 */
export class OrderProcessor {
  private readonly worker: Worker<OrderJob, OrderResult>;
  private readonly router: DexRouter;
  private readonly executor: OrderExecutor;
  private readonly repository: OrderRepository;
  private readonly cache: OrderCache;
  private readonly config: EnvironmentConfig;
  private statusUpdateCallback?: (orderId: string, status: string, data?: any) => void;

  constructor(
    router: DexRouter,
    executor: OrderExecutor,
    repository: OrderRepository,
    cache: OrderCache,
    config: EnvironmentConfig
  ) {
    this.router = router;
    this.executor = executor;
    this.repository = repository;
    this.cache = cache;
    this.config = config;

    // Get Redis connection for BullMQ worker
    const connection = getRedisClient();

    // Configure worker options
    // Requirement 4.1: Concurrency limit of 10
    const workerOptions: WorkerOptions = {
      connection,
      concurrency: config.QUEUE_CONCURRENCY,
      // Requirement 4.3: Integrate retry logic with queue job attempts
      autorun: true,
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 }
    };

    // Create worker with process handler
    this.worker = new Worker<OrderJob, OrderResult>(
      'order-processing',
      (job) => this.process(job),
      workerOptions
    );

    // Attach event handlers
    this.worker.on('completed', (job, result) => this.onCompleted(job, result));
    this.worker.on('failed', (job, error) => this.onFailed(job, error));
    this.worker.on('active', (job) => {
      logger.info({ orderId: job.data.orderId, attempt: job.attemptsMade + 1 }, 'Order processing started');
    });

    logger.info({
      concurrency: config.QUEUE_CONCURRENCY,
      maxRetries: config.QUEUE_MAX_RETRIES
    }, 'OrderProcessor initialized');
  }

  /**
   * Set callback for status updates (WebSocket emission)
   * @param callback - Function to call on status updates
   */
  setStatusUpdateCallback(callback: (orderId: string, status: string, data?: any) => void): void {
    this.statusUpdateCallback = callback;
  }

  /**
   * Process an order job
   * Requirement 4.5: FIFO order processing within concurrency limits
   * 
   * @param job - BullMQ job containing order data
   * @returns Order processing result
   */
  async process(job: Job<OrderJob>): Promise<OrderResult> {
    const { orderId, tokenIn, tokenOut, amount, slippage } = job.data;

    logger.info({
      orderId,
      tokenIn,
      tokenOut,
      amount,
      slippage,
      attempt: job.attemptsMade + 1,
      maxAttempts: this.config.QUEUE_MAX_RETRIES
    }, 'Processing order');

    try {
      // Update status to routing
      await this.updateOrderStatus(orderId, 'routing');
      this.emitStatusUpdate(orderId, 'routing');

      // Get quotes from both DEXs
      const quotes = await withRetry(
        () => this.router.getQuotes(tokenIn, tokenOut, amount),
        {
          config: {
            maxAttempts: this.config.QUEUE_MAX_RETRIES,
            initialDelay: this.config.QUEUE_BACKOFF_DELAY,
            backoffMultiplier: 2,
            maxDelay: 4000
          },
          onRetry: (error, attempt, delay) => {
            logger.warn({
              orderId,
              attempt,
              delay,
              error: error.message
            }, 'Retrying quote request');
          }
        }
      );

      // Select best DEX
      const bestQuote = this.router.selectBestDex(quotes);

      // Update order with selected DEX
      await this.repository.updateStatus(orderId, 'routing', {
        selectedDex: bestQuote.dex
      });

      // Update status to building
      await this.updateOrderStatus(orderId, 'building', {
        selectedDex: bestQuote.dex
      });
      this.emitStatusUpdate(orderId, 'building', {
        routingDecision: {
          selectedDex: bestQuote.dex,
          raydiumPrice: quotes.find(q => q.dex === 'raydium')?.effectivePrice || 0,
          meteoraPrice: quotes.find(q => q.dex === 'meteora')?.effectivePrice || 0
        }
      });

      // Execute swap with retry
      const swapResult = await withRetry(
        () => this.executor.executeSwap(bestQuote, tokenIn, tokenOut, amount, slippage),
        {
          config: {
            maxAttempts: this.config.QUEUE_MAX_RETRIES,
            initialDelay: this.config.QUEUE_BACKOFF_DELAY,
            backoffMultiplier: 2,
            maxDelay: 4000
          },
          onRetry: (error, attempt, delay) => {
            logger.warn({
              orderId,
              attempt,
              delay,
              error: error.message
            }, 'Retrying swap execution');
          }
        }
      );

      // Update status to submitted
      await this.updateOrderStatus(orderId, 'submitted', {
        txHash: swapResult.txHash
      });
      this.emitStatusUpdate(orderId, 'submitted', {
        txHash: swapResult.txHash
      });

      // Update status to confirmed with final details
      await this.updateOrderStatus(orderId, 'confirmed', {
        txHash: swapResult.txHash,
        executedPrice: swapResult.executedPrice,
        inputAmount: swapResult.inputAmount,
        outputAmount: swapResult.outputAmount
      });
      this.emitStatusUpdate(orderId, 'confirmed', {
        txHash: swapResult.txHash,
        executedPrice: swapResult.executedPrice
      });

      logger.info({
        orderId,
        txHash: swapResult.txHash,
        executedPrice: swapResult.executedPrice,
        selectedDex: bestQuote.dex
      }, 'Order processed successfully');

      return {
        orderId,
        status: 'confirmed',
        txHash: swapResult.txHash,
        executedPrice: swapResult.executedPrice
      };

    } catch (error) {
      // Classify and handle error
      const categorizedError = classifyError(error);
      
      logger.error({
        orderId,
        error: categorizedError.message,
        category: categorizedError.category,
        isRetryable: categorizedError.isRetryable,
        attempt: job.attemptsMade + 1
      }, 'Order processing failed');

      // Emit error event
      errorEmitter.emitError(categorizedError, { orderId });

      // If critical, emit critical error event
      if (isCriticalError(categorizedError)) {
        errorEmitter.emitCriticalError(categorizedError, { orderId });
      }

      // If not retryable or max attempts reached, mark as failed
      if (!categorizedError.isRetryable || job.attemptsMade + 1 >= this.config.QUEUE_MAX_RETRIES) {
        // Requirement 4.4: Mark as failed after retry attempts exhausted
        await this.updateOrderStatus(orderId, 'failed', {
          failureReason: categorizedError.message
        });
        this.emitStatusUpdate(orderId, 'failed', {
          error: categorizedError.message
        });

        return {
          orderId,
          status: 'failed',
          error: categorizedError.message
        };
      }

      // Re-throw for BullMQ to handle retry
      throw categorizedError;
    }
  }

  /**
   * Handler for completed jobs
   * @param job - Completed job
   * @param result - Job result
   */
  async onCompleted(job: Job<OrderJob>, result: OrderResult): Promise<void> {
    logger.info({
      orderId: result.orderId,
      status: result.status,
      txHash: result.txHash,
      attempts: job.attemptsMade + 1
    }, 'Order job completed');

    // Clean up cache after completion
    await this.cache.delete(result.orderId);
  }

  /**
   * Handler for failed jobs
   * Requirement 4.4: Emit "failed" status and persist failure reason
   * 
   * @param job - Failed job
   * @param error - Error that caused failure
   */
  async onFailed(job: Job<OrderJob> | undefined, error: Error): Promise<void> {
    if (!job) {
      logger.error({ error: error.message }, 'Job failed without job data');
      return;
    }

    const orderId = job.data.orderId;

    logger.error({
      orderId,
      error: error.message,
      attempts: job.attemptsMade,
      maxAttempts: this.config.QUEUE_MAX_RETRIES
    }, 'Order job failed permanently');

    // Ensure order is marked as failed in database
    try {
      await this.repository.updateStatus(orderId, 'failed', {
        failureReason: error.message
      });

      // Emit final failed status
      this.emitStatusUpdate(orderId, 'failed', {
        error: error.message
      });

      // Clean up cache
      await this.cache.delete(orderId);
    } catch (updateError) {
      logger.error({
        orderId,
        error: updateError instanceof Error ? updateError.message : String(updateError)
      }, 'Failed to update order status after job failure');
    }
  }

  /**
   * Update order status in database and cache
   * @param orderId - Order ID
   * @param status - New status
   * @param data - Additional data to update
   */
  private async updateOrderStatus(
    orderId: string,
    status: string,
    data?: Partial<OrderRecord>
  ): Promise<void> {
    // Update in database
    await this.repository.updateStatus(orderId, status as any, data);

    // Update in cache
    const order = await this.repository.findById(orderId);
    if (order) {
      await this.cache.set(orderId, order);
    }
  }

  /**
   * Emit status update via callback (for WebSocket)
   * @param orderId - Order ID
   * @param status - New status
   * @param data - Additional data
   */
  private emitStatusUpdate(orderId: string, status: string, data?: any): void {
    if (this.statusUpdateCallback) {
      this.statusUpdateCallback(orderId, status, data);
    }
  }

  /**
   * Close the worker
   */
  async close(): Promise<void> {
    await this.worker.close();
    logger.info('OrderProcessor worker closed');
  }

  /**
   * Pause the worker
   */
  async pause(): Promise<void> {
    await this.worker.pause();
    logger.info('OrderProcessor worker paused');
  }

  /**
   * Resume the worker
   */
  async resume(): Promise<void> {
    await this.worker.resume();
    logger.info('OrderProcessor worker resumed');
  }

  /**
   * Get worker instance
   */
  getWorker(): Worker<OrderJob, OrderResult> {
    return this.worker;
  }
}
