import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FastifyServer, ValidationError } from './FastifyServer.js';
import { WebSocketManager } from './WebSocketManager.js';
import { OrderQueue } from '../queue/OrderQueue.js';
import { OrderRepository } from '../persistence/OrderRepository.js';
import { EnvironmentConfig } from '../config/env.js';
import { OrderRequest } from '../types/index.js';

describe('FastifyServer', () => {
  let server: FastifyServer;
  let mockConfig: EnvironmentConfig;
  let mockOrderQueue: OrderQueue;
  let mockWsManager: WebSocketManager;
  let mockOrderRepository: OrderRepository;

  beforeEach(() => {
    // Create mock config
    mockConfig = {
      PORT: 3000,
      HOST: '0.0.0.0',
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      DEFAULT_SLIPPAGE: 0.01,
      MAX_SLIPPAGE: 0.1,
    } as EnvironmentConfig;

    // Create mock dependencies
    mockOrderQueue = {
      enqueue: vi.fn().mockResolvedValue('job-id'),
    } as any;

    mockWsManager = {
      addConnection: vi.fn(),
      emitStatusUpdate: vi.fn(),
      closeAll: vi.fn(),
    } as any;

    mockOrderRepository = {
      create: vi.fn().mockResolvedValue({
        orderId: 'test-order-id',
        tokenIn: 'token-in',
        tokenOut: 'token-out',
        amount: 1000,
        slippage: 0.01,
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    } as any;

    server = new FastifyServer(
      mockConfig,
      mockOrderQueue,
      mockWsManager,
      mockOrderRepository
    );
  });

  afterEach(async () => {
    await server.stop();
  });

  describe('Order Validation', () => {
    it('should accept valid order with all required fields', async () => {
      const validOrder: OrderRequest = {
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: 1000,
        slippage: 0.01,
      };

      // Access private method through reflection for testing
      const validateOrder = (server as any).validateOrder.bind(server);
      expect(() => validateOrder(validOrder)).not.toThrow();
    });

    it('should throw ValidationError when tokenIn is missing', () => {
      const invalidOrder = {
        tokenOut: 'USDC',
        amount: 1000,
      } as OrderRequest;

      const validateOrder = (server as any).validateOrder.bind(server);
      expect(() => validateOrder(invalidOrder)).toThrow(ValidationError);
      expect(() => validateOrder(invalidOrder)).toThrow('tokenIn is required');
    });

    it('should throw ValidationError when tokenOut is missing', () => {
      const invalidOrder = {
        tokenIn: 'SOL',
        amount: 1000,
      } as OrderRequest;

      const validateOrder = (server as any).validateOrder.bind(server);
      expect(() => validateOrder(invalidOrder)).toThrow(ValidationError);
      expect(() => validateOrder(invalidOrder)).toThrow('tokenOut is required');
    });

    it('should throw ValidationError when amount is missing', () => {
      const invalidOrder = {
        tokenIn: 'SOL',
        tokenOut: 'USDC',
      } as any;

      const validateOrder = (server as any).validateOrder.bind(server);
      expect(() => validateOrder(invalidOrder)).toThrow(ValidationError);
      expect(() => validateOrder(invalidOrder)).toThrow('amount is required');
    });

    it('should throw ValidationError when amount is zero', () => {
      const invalidOrder: OrderRequest = {
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: 0,
      };

      const validateOrder = (server as any).validateOrder.bind(server);
      expect(() => validateOrder(invalidOrder)).toThrow(ValidationError);
      expect(() => validateOrder(invalidOrder)).toThrow('amount must be greater than 0');
    });

    it('should throw ValidationError when amount is negative', () => {
      const invalidOrder: OrderRequest = {
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: -100,
      };

      const validateOrder = (server as any).validateOrder.bind(server);
      expect(() => validateOrder(invalidOrder)).toThrow(ValidationError);
      expect(() => validateOrder(invalidOrder)).toThrow('amount must be greater than 0');
    });

    it('should throw ValidationError when amount is not a number', () => {
      const invalidOrder = {
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: 'not-a-number',
      } as any;

      const validateOrder = (server as any).validateOrder.bind(server);
      expect(() => validateOrder(invalidOrder)).toThrow(ValidationError);
      expect(() => validateOrder(invalidOrder)).toThrow('amount must be a number');
    });

    it('should throw ValidationError when amount is NaN', () => {
      const invalidOrder: OrderRequest = {
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: NaN,
      };

      const validateOrder = (server as any).validateOrder.bind(server);
      expect(() => validateOrder(invalidOrder)).toThrow(ValidationError);
      expect(() => validateOrder(invalidOrder)).toThrow('amount must be a finite number');
    });

    it('should throw ValidationError when amount is Infinity', () => {
      const invalidOrder: OrderRequest = {
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: Infinity,
      };

      const validateOrder = (server as any).validateOrder.bind(server);
      expect(() => validateOrder(invalidOrder)).toThrow(ValidationError);
      expect(() => validateOrder(invalidOrder)).toThrow('amount must be a finite number');
    });

    it('should throw ValidationError when tokenIn is empty', () => {
      const invalidOrder: OrderRequest = {
        tokenIn: '',
        tokenOut: 'USDC',
        amount: 1000,
      };

      const validateOrder = (server as any).validateOrder.bind(server);
      expect(() => validateOrder(invalidOrder)).toThrow(ValidationError);
      expect(() => validateOrder(invalidOrder)).toThrow('tokenIn cannot be empty');
    });

    it('should throw ValidationError when tokenOut is empty', () => {
      const invalidOrder: OrderRequest = {
        tokenIn: 'SOL',
        tokenOut: '',
        amount: 1000,
      };

      const validateOrder = (server as any).validateOrder.bind(server);
      expect(() => validateOrder(invalidOrder)).toThrow(ValidationError);
      expect(() => validateOrder(invalidOrder)).toThrow('tokenOut cannot be empty');
    });

    it('should throw ValidationError when tokenIn and tokenOut are the same', () => {
      const invalidOrder: OrderRequest = {
        tokenIn: 'SOL',
        tokenOut: 'SOL',
        amount: 1000,
      };

      const validateOrder = (server as any).validateOrder.bind(server);
      expect(() => validateOrder(invalidOrder)).toThrow(ValidationError);
      expect(() => validateOrder(invalidOrder)).toThrow('tokenIn and tokenOut must be different');
    });

    it('should throw ValidationError when slippage is negative', () => {
      const invalidOrder: OrderRequest = {
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: 1000,
        slippage: -0.01,
      };

      const validateOrder = (server as any).validateOrder.bind(server);
      expect(() => validateOrder(invalidOrder)).toThrow(ValidationError);
      expect(() => validateOrder(invalidOrder)).toThrow('slippage must be non-negative');
    });

    it('should throw ValidationError when slippage is not a number', () => {
      const invalidOrder = {
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: 1000,
        slippage: 'not-a-number',
      } as any;

      const validateOrder = (server as any).validateOrder.bind(server);
      expect(() => validateOrder(invalidOrder)).toThrow(ValidationError);
      expect(() => validateOrder(invalidOrder)).toThrow('slippage must be a number');
    });

    it('should throw ValidationError when slippage is NaN', () => {
      const invalidOrder: OrderRequest = {
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: 1000,
        slippage: NaN,
      };

      const validateOrder = (server as any).validateOrder.bind(server);
      expect(() => validateOrder(invalidOrder)).toThrow(ValidationError);
      expect(() => validateOrder(invalidOrder)).toThrow('slippage must be a finite number');
    });

    it('should accept order without slippage (optional field)', () => {
      const validOrder: OrderRequest = {
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: 1000,
      };

      const validateOrder = (server as any).validateOrder.bind(server);
      expect(() => validateOrder(validOrder)).not.toThrow();
    });
  });

  describe('Health Check', () => {
    it('should respond to health check endpoint', async () => {
      const app = server.getApp();
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('ok');
      expect(body.timestamp).toBeDefined();
    });
  });
});
