import Fastify, { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { EnvironmentConfig } from '../config/env.js';
import { OrderRequest, OrderResponse, OrderJob } from '../types/index.js';
import { OrderQueue } from '../queue/OrderQueue.js';
import { WebSocketManager } from './WebSocketManager.js';
import { OrderRepository } from '../persistence/OrderRepository.js';
import { logger } from '../utils/logger.js';

/**
 * Validation error class for order validation failures
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * FastifyServer manages the HTTP API and WebSocket connections
 * Handles order submission, validation, and WebSocket upgrades
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
 */
export class FastifyServer {
  private readonly app: FastifyInstance;
  private readonly config: EnvironmentConfig;
  private readonly orderQueue: OrderQueue;
  private readonly wsManager: WebSocketManager;
  private readonly orderRepository: OrderRepository;

  constructor(
    config: EnvironmentConfig,
    orderQueue: OrderQueue,
    wsManager: WebSocketManager,
    orderRepository: OrderRepository
  ) {
    this.config = config;
    this.orderQueue = orderQueue;
    this.wsManager = wsManager;
    this.orderRepository = orderRepository;

    // Initialize Fastify with logging
    this.app = Fastify({
      logger: {
        level: config.LOG_LEVEL,
      },
    });

    // Register WebSocket plugin
    this.app.register(fastifyWebsocket);

    // Register routes
    this.registerRoutes();
  }

  /**
   * Register all API routes
   */
  private registerRoutes(): void {
    // Health check endpoint
    this.app.get('/health', async () => {
      return { status: 'ok', timestamp: Date.now() };
    });

    // Order submission endpoint with WebSocket upgrade
    this.app.post<{ Body: OrderRequest }>(
      '/api/orders/execute',
      {
        schema: {
          body: {
            type: 'object',
            required: ['tokenIn', 'tokenOut', 'amount'],
            properties: {
              tokenIn: { type: 'string' },
              tokenOut: { type: 'string' },
              amount: { type: 'number' },
              slippage: { type: 'number' },
            },
          },
        },
        websocket: true,
      },
      async (connection, request) => {
        await this.handleOrderSubmission(connection, request);
      }
    );
  }

  /**
   * Handle order submission with WebSocket upgrade
   * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
   */
  private async handleOrderSubmission(
    connection: any,
    request: FastifyRequest<{ Body: OrderRequest }>
  ): Promise<void> {
    const orderRequest = request.body;

    try {
      // Requirement 1.2: Validate order parameters
      this.validateOrder(orderRequest);

      // Requirement 1.1: Generate unique orderId (handled by database)

      // Apply default slippage if not provided
      const slippage = orderRequest.slippage ?? this.config.DEFAULT_SLIPPAGE;

      // Validate slippage is within acceptable range
      if (slippage < 0 || slippage > this.config.MAX_SLIPPAGE) {
        throw new ValidationError(
          `Slippage must be between 0 and ${this.config.MAX_SLIPPAGE}, got: ${slippage}`
        );
      }

      // Create order record in database
      const orderRecord = await this.orderRepository.create({
        tokenIn: orderRequest.tokenIn,
        tokenOut: orderRequest.tokenOut,
        amount: orderRequest.amount,
        slippage,
        status: 'pending',
      });

      logger.info(
        {
          orderId: orderRecord.orderId,
          tokenIn: orderRequest.tokenIn,
          tokenOut: orderRequest.tokenOut,
          amount: orderRequest.amount,
          slippage,
        },
        'Order created successfully'
      );

      // Requirement 1.5: Upgrade HTTP connection to WebSocket
      const ws = connection.socket;
      this.wsManager.addConnection(orderRecord.orderId, ws);

      // Send initial response with orderId
      const response: OrderResponse = {
        orderId: orderRecord.orderId,
        status: 'pending',
        timestamp: Date.now(),
      };

      ws.send(JSON.stringify(response));

      // Requirement 1.4: Add order to queue for processing
      const orderJob: OrderJob = {
        orderId: orderRecord.orderId,
        tokenIn: orderRequest.tokenIn,
        tokenOut: orderRequest.tokenOut,
        amount: orderRequest.amount,
        slippage,
        attempt: 1,
      };

      await this.orderQueue.enqueue(orderJob);

      logger.info({ orderId: orderRecord.orderId }, 'Order enqueued for processing');

      // Emit initial pending status via WebSocket
      this.wsManager.emitStatusUpdate(orderRecord.orderId, 'pending');
    } catch (error) {
      // Requirement 1.3: Return HTTP 400 error for validation failures
      logger.error({ error, orderRequest }, 'Order validation failed');

      const ws = connection.socket;
      const errorMessage = {
        error: {
          code: 'VALIDATION_ERROR',
          message: error instanceof Error ? error.message : 'Invalid order parameters',
        },
        timestamp: Date.now(),
      };

      ws.send(JSON.stringify(errorMessage));
      ws.close();
    }
  }

  /**
   * Validate order parameters
   * Requirement 1.2: Verify all required fields are present and properly formatted
   * Requirement 1.3: Throw ValidationError for invalid orders
   */
  private validateOrder(order: OrderRequest): void {
    // Check required fields
    if (order.tokenIn === undefined || order.tokenIn === null) {
      throw new ValidationError('tokenIn is required and must be a string');
    }

    if (typeof order.tokenIn !== 'string') {
      throw new ValidationError('tokenIn is required and must be a string');
    }

    if (order.tokenOut === undefined || order.tokenOut === null) {
      throw new ValidationError('tokenOut is required and must be a string');
    }

    if (typeof order.tokenOut !== 'string') {
      throw new ValidationError('tokenOut is required and must be a string');
    }

    if (order.amount === undefined || order.amount === null) {
      throw new ValidationError('amount is required');
    }

    if (typeof order.amount !== 'number') {
      throw new ValidationError('amount must be a number');
    }

    // Validate amount is positive
    if (order.amount <= 0) {
      throw new ValidationError('amount must be greater than 0');
    }

    // Validate amount is not NaN or Infinity
    if (!Number.isFinite(order.amount)) {
      throw new ValidationError('amount must be a finite number');
    }

    // Validate token addresses are not empty
    if (order.tokenIn.trim().length === 0) {
      throw new ValidationError('tokenIn cannot be empty');
    }

    if (order.tokenOut.trim().length === 0) {
      throw new ValidationError('tokenOut cannot be empty');
    }

    // Validate tokens are different
    if (order.tokenIn === order.tokenOut) {
      throw new ValidationError('tokenIn and tokenOut must be different');
    }

    // Validate slippage if provided
    if (order.slippage !== undefined) {
      if (typeof order.slippage !== 'number') {
        throw new ValidationError('slippage must be a number');
      }

      if (!Number.isFinite(order.slippage)) {
        throw new ValidationError('slippage must be a finite number');
      }

      if (order.slippage < 0) {
        throw new ValidationError('slippage must be non-negative');
      }
    }

    logger.debug({ order }, 'Order validation passed');
  }

  /**
   * Start the Fastify server
   */
  async start(): Promise<void> {
    try {
      await this.app.listen({
        port: this.config.PORT,
        host: this.config.HOST,
      });

      logger.info(
        {
          port: this.config.PORT,
          host: this.config.HOST,
          env: this.config.NODE_ENV,
        },
        'Fastify server started successfully'
      );
    } catch (error) {
      logger.error({ error }, 'Failed to start Fastify server');
      throw error;
    }
  }

  /**
   * Stop the Fastify server gracefully
   */
  async stop(): Promise<void> {
    try {
      // Close all WebSocket connections
      this.wsManager.closeAll();

      // Close Fastify server
      await this.app.close();

      logger.info('Fastify server stopped successfully');
    } catch (error) {
      logger.error({ error }, 'Error stopping Fastify server');
      throw error;
    }
  }

  /**
   * Get the Fastify app instance (for testing)
   */
  getApp(): FastifyInstance {
    return this.app;
  }
}
