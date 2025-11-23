import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OrderProcessor } from './OrderProcessor';
import { DexRouter } from '../routing/DexRouter';
import { OrderExecutor } from '../execution/OrderExecutor';
import { OrderRepository } from '../persistence/OrderRepository';
import { OrderCache } from '../persistence/OrderCache';
import { EnvironmentConfig } from '../config/env';
import { OrderJob, DexQuote, SwapResult } from '../types';
import { Job } from 'bullmq';

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

// Mock error emitter
vi.mock('../errors', async () => {
  const actual = await vi.importActual('../errors');
  return {
    ...actual,
    errorEmitter: {
      emitError: vi.fn(),
      emitCriticalError: vi.fn(),
      on: vi.fn(),
      emit: vi.fn()
    }
  };
});

describe('OrderProcessor', () => {
  let processor: OrderProcessor;
  let mockRouter: DexRouter;
  let mockExecutor: OrderExecutor;
  let mockRepository: OrderRepository;
  let mockCache: OrderCache;
  let mockConfig: EnvironmentConfig;

  beforeEach(() => {
    // Create mocks
    mockRouter = {
      getQuotes: vi.fn(),
      selectBestDex: vi.fn()
    } as any;

    mockExecutor = {
      executeSwap: vi.fn()
    } as any;

    mockRepository = {
      updateStatus: vi.fn(),
      findById: vi.fn()
    } as any;

    mockCache = {
      set: vi.fn(),
      delete: vi.fn()
    } as any;

    mockConfig = {
      QUEUE_CONCURRENCY: 10,
      QUEUE_MAX_RETRIES: 3,
      QUEUE_BACKOFF_DELAY: 1000,
      REDIS_HOST: 'localhost',
      REDIS_PORT: 6379,
      REDIS_DB: 0
    } as EnvironmentConfig;

    processor = new OrderProcessor(
      mockRouter,
      mockExecutor,
      mockRepository,
      mockCache,
      mockConfig
    );
  });

  afterEach(async () => {
    await processor.close();
  });

  describe('process', () => {
    it('should process an order successfully', async () => {
      const orderJob: OrderJob = {
        orderId: 'test-order-1',
        tokenIn: 'TokenA',
        tokenOut: 'TokenB',
        amount: 1000,
        slippage: 0.01,
        attempt: 1
      };

      const mockQuotes: DexQuote[] = [
        {
          dex: 'raydium',
          price: 1.0,
          fee: 0.003,
          effectivePrice: 0.997,
          estimatedOutput: 997
        },
        {
          dex: 'meteora',
          price: 1.02,
          fee: 0.002,
          effectivePrice: 1.018,
          estimatedOutput: 1018
        }
      ];

      const mockSwapResult: SwapResult = {
        txHash: 'mock-tx-hash',
        executedPrice: 1.015,
        inputAmount: 1000,
        outputAmount: 1015,
        fee: 2,
        timestamp: Date.now()
      };

      vi.mocked(mockRouter.getQuotes).mockResolvedValue(mockQuotes);
      vi.mocked(mockRouter.selectBestDex).mockReturnValue(mockQuotes[1]);
      vi.mocked(mockExecutor.executeSwap).mockResolvedValue(mockSwapResult);
      vi.mocked(mockRepository.findById).mockResolvedValue({
        orderId: orderJob.orderId,
        status: 'confirmed',
        createdAt: new Date(),
        updatedAt: new Date()
      } as any);

      const mockJob = {
        data: orderJob,
        attemptsMade: 0,
        id: orderJob.orderId
      } as Job<OrderJob>;

      const result = await processor.process(mockJob);

      expect(result.status).toBe('confirmed');
      expect(result.orderId).toBe(orderJob.orderId);
      expect(result.txHash).toBe('mock-tx-hash');
      expect(mockRouter.getQuotes).toHaveBeenCalledWith('TokenA', 'TokenB', 1000);
      expect(mockRouter.selectBestDex).toHaveBeenCalledWith(mockQuotes);
      expect(mockExecutor.executeSwap).toHaveBeenCalled();
    });

    it('should handle routing errors and retry', async () => {
      const orderJob: OrderJob = {
        orderId: 'test-order-2',
        tokenIn: 'TokenA',
        tokenOut: 'TokenB',
        amount: 1000,
        slippage: 0.01,
        attempt: 1
      };

      vi.mocked(mockRouter.getQuotes).mockRejectedValue(new Error('Routing failed'));

      const mockJob = {
        data: orderJob,
        attemptsMade: 0,
        id: orderJob.orderId
      } as Job<OrderJob>;

      await expect(processor.process(mockJob)).rejects.toThrow();
    });

    it('should mark order as failed after max retries', async () => {
      const orderJob: OrderJob = {
        orderId: 'test-order-3',
        tokenIn: 'TokenA',
        tokenOut: 'TokenB',
        amount: 1000,
        slippage: 0.01,
        attempt: 3
      };

      vi.mocked(mockRouter.getQuotes).mockRejectedValue(new Error('Persistent failure'));
      vi.mocked(mockRepository.findById).mockResolvedValue({
        orderId: orderJob.orderId,
        status: 'failed',
        createdAt: new Date(),
        updatedAt: new Date()
      } as any);

      const mockJob = {
        data: orderJob,
        attemptsMade: 2, // Already at max attempts
        id: orderJob.orderId
      } as Job<OrderJob>;

      const result = await processor.process(mockJob);

      expect(result.status).toBe('failed');
      expect(result.error).toBeDefined();
      expect(mockRepository.updateStatus).toHaveBeenCalledWith(
        orderJob.orderId,
        'failed',
        expect.objectContaining({ failureReason: expect.any(String) })
      );
    });

    it('should update order status through all stages', async () => {
      const orderJob: OrderJob = {
        orderId: 'test-order-4',
        tokenIn: 'TokenA',
        tokenOut: 'TokenB',
        amount: 1000,
        slippage: 0.01,
        attempt: 1
      };

      const mockQuotes: DexQuote[] = [
        {
          dex: 'raydium',
          price: 1.0,
          fee: 0.003,
          effectivePrice: 0.997,
          estimatedOutput: 997
        }
      ];

      const mockSwapResult: SwapResult = {
        txHash: 'mock-tx-hash',
        executedPrice: 0.995,
        inputAmount: 1000,
        outputAmount: 995,
        fee: 3,
        timestamp: Date.now()
      };

      vi.mocked(mockRouter.getQuotes).mockResolvedValue(mockQuotes);
      vi.mocked(mockRouter.selectBestDex).mockReturnValue(mockQuotes[0]);
      vi.mocked(mockExecutor.executeSwap).mockResolvedValue(mockSwapResult);
      vi.mocked(mockRepository.findById).mockResolvedValue({
        orderId: orderJob.orderId,
        status: 'confirmed',
        createdAt: new Date(),
        updatedAt: new Date()
      } as any);

      const mockJob = {
        data: orderJob,
        attemptsMade: 0,
        id: orderJob.orderId
      } as Job<OrderJob>;

      await processor.process(mockJob);

      // Verify status updates were called
      const updateCalls = vi.mocked(mockRepository.updateStatus).mock.calls;
      const statuses = updateCalls.map(call => call[1]);
      
      expect(statuses).toContain('routing');
      expect(statuses).toContain('building');
      expect(statuses).toContain('submitted');
      expect(statuses).toContain('confirmed');
    });
  });

  describe('status update callback', () => {
    it('should call status update callback when set', async () => {
      const statusCallback = vi.fn();
      processor.setStatusUpdateCallback(statusCallback);

      const orderJob: OrderJob = {
        orderId: 'test-order-5',
        tokenIn: 'TokenA',
        tokenOut: 'TokenB',
        amount: 1000,
        slippage: 0.01,
        attempt: 1
      };

      const mockQuotes: DexQuote[] = [
        {
          dex: 'raydium',
          price: 1.0,
          fee: 0.003,
          effectivePrice: 0.997,
          estimatedOutput: 997
        }
      ];

      const mockSwapResult: SwapResult = {
        txHash: 'mock-tx-hash',
        executedPrice: 0.995,
        inputAmount: 1000,
        outputAmount: 995,
        fee: 3,
        timestamp: Date.now()
      };

      vi.mocked(mockRouter.getQuotes).mockResolvedValue(mockQuotes);
      vi.mocked(mockRouter.selectBestDex).mockReturnValue(mockQuotes[0]);
      vi.mocked(mockExecutor.executeSwap).mockResolvedValue(mockSwapResult);
      vi.mocked(mockRepository.findById).mockResolvedValue({
        orderId: orderJob.orderId,
        status: 'confirmed',
        createdAt: new Date(),
        updatedAt: new Date()
      } as any);

      const mockJob = {
        data: orderJob,
        attemptsMade: 0,
        id: orderJob.orderId
      } as Job<OrderJob>;

      await processor.process(mockJob);

      expect(statusCallback).toHaveBeenCalled();
      expect(statusCallback).toHaveBeenCalledWith('test-order-5', 'routing', undefined);
      expect(statusCallback).toHaveBeenCalledWith('test-order-5', 'building', expect.any(Object));
      expect(statusCallback).toHaveBeenCalledWith('test-order-5', 'submitted', expect.any(Object));
      expect(statusCallback).toHaveBeenCalledWith('test-order-5', 'confirmed', expect.any(Object));
    });
  });

  describe('onCompleted', () => {
    it('should clean up cache on completion', async () => {
      const orderJob: OrderJob = {
        orderId: 'test-order-6',
        tokenIn: 'TokenA',
        tokenOut: 'TokenB',
        amount: 1000,
        slippage: 0.01,
        attempt: 1
      };

      const mockJob = {
        data: orderJob,
        attemptsMade: 0,
        id: orderJob.orderId
      } as Job<OrderJob>;

      const result = {
        orderId: orderJob.orderId,
        status: 'confirmed' as const,
        txHash: 'mock-tx-hash'
      };

      await processor.onCompleted(mockJob, result);

      expect(mockCache.delete).toHaveBeenCalledWith(orderJob.orderId);
    });
  });

  describe('onFailed', () => {
    it('should update order status and clean up cache on failure', async () => {
      const orderJob: OrderJob = {
        orderId: 'test-order-7',
        tokenIn: 'TokenA',
        tokenOut: 'TokenB',
        amount: 1000,
        slippage: 0.01,
        attempt: 3
      };

      const mockJob = {
        data: orderJob,
        attemptsMade: 3,
        id: orderJob.orderId
      } as Job<OrderJob>;

      const error = new Error('Processing failed');

      await processor.onFailed(mockJob, error);

      expect(mockRepository.updateStatus).toHaveBeenCalledWith(
        orderJob.orderId,
        'failed',
        expect.objectContaining({ failureReason: 'Processing failed' })
      );
      expect(mockCache.delete).toHaveBeenCalledWith(orderJob.orderId);
    });
  });
});
