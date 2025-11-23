import { loadConfig } from '@config/env';
import { logger } from '@utils/logger';
import { closePool, testConnection } from '@persistence/database';
import { closeRedis, testRedisConnection } from '@persistence/redis';
import { OrderRepository } from '@persistence/OrderRepository';
import { OrderCache } from '@persistence/OrderCache';
import { MockRaydiumClient } from '@routing/MockRaydiumClient';
import { MockMeteoraClient } from '@routing/MockMeteoraClient';
import { DexRouter } from '@routing/DexRouter';
import { OrderExecutor } from '@execution/OrderExecutor';
import { OrderQueue } from '@queue/OrderQueue';
import { OrderProcessor } from '@queue/OrderProcessor';
import { WebSocketManager } from '@api/WebSocketManager';
import { FastifyServer } from '@api/FastifyServer';

/**
 * Application container holding all initialized components
 */
interface AppContainer {
  config: ReturnType<typeof loadConfig>;
  orderRepository: OrderRepository;
  orderCache: OrderCache;
  dexRouter: DexRouter;
  orderExecutor: OrderExecutor;
  orderQueue: OrderQueue;
  orderProcessor: OrderProcessor;
  wsManager: WebSocketManager;
  fastifyServer: FastifyServer;
}

let appContainer: AppContainer | null = null;

/**
 * Initialize all application components with dependency injection
 * Requirements: 8.1, 8.2, 8.3
 */
async function initializeComponents(): Promise<AppContainer> {
  // Load configuration
  const config = loadConfig();
  logger.info(
    { 
      config: { 
        ...config, 
        POSTGRES_PASSWORD: '***', 
        REDIS_PASSWORD: '***',
        SOLANA_WALLET_PRIVATE_KEY: config.SOLANA_WALLET_PRIVATE_KEY ? '***' : undefined
      } 
    }, 
    'Configuration loaded'
  );

  // Test database connection
  logger.info('Testing PostgreSQL connection...');
  const dbConnected = await testConnection();
  if (!dbConnected) {
    throw new Error('Failed to connect to PostgreSQL database');
  }
  logger.info('PostgreSQL connection successful');

  // Test Redis connection
  logger.info('Testing Redis connection...');
  const redisConnected = await testRedisConnection();
  if (!redisConnected) {
    throw new Error('Failed to connect to Redis');
  }
  logger.info('Redis connection successful');

  // Initialize persistence layer
  const orderRepository = new OrderRepository();
  const orderCache = new OrderCache();
  logger.info('Persistence layer initialized');

  // Initialize DEX clients (mock or real based on configuration)
  const raydiumClient = new MockRaydiumClient();
  const meteoraClient = new MockMeteoraClient();
  logger.info({ implementation: config.DEX_IMPLEMENTATION }, 'DEX clients initialized');

  // Initialize routing layer
  // Requirement 8.2: Queue uses router for price discovery
  const dexRouter = new DexRouter(
    raydiumClient, 
    meteoraClient, 
    { quoteTimeout: config.DEX_QUOTE_TIMEOUT }
  );
  logger.info('DEX Router initialized');

  // Initialize execution layer
  // Requirement 8.3: Router delegates to executor for swap transactions
  const orderExecutor = new OrderExecutor(
    raydiumClient, 
    meteoraClient, 
    {
      defaultSlippage: config.DEFAULT_SLIPPAGE,
      maxSlippage: config.MAX_SLIPPAGE
    }
  );
  logger.info('Order Executor initialized');

  // Initialize queue layer
  const orderQueue = new OrderQueue(config);
  logger.info('Order Queue initialized');

  // Initialize order processor with dependencies
  const orderProcessor = new OrderProcessor(
    dexRouter,
    orderExecutor,
    orderRepository,
    orderCache,
    config
  );
  logger.info('Order Processor initialized');

  // Initialize WebSocket manager
  const wsManager = new WebSocketManager();
  logger.info('WebSocket Manager initialized');

  // Wire WebSocket updates to order processor
  orderProcessor.setStatusUpdateCallback((orderId, status, data) => {
    wsManager.emitStatusUpdate(orderId, status as any, data);
  });
  logger.info('WebSocket status updates wired to Order Processor');

  // Initialize API layer
  // Requirement 8.1: API delegates to queue for order processing
  const fastifyServer = new FastifyServer(
    config,
    orderQueue,
    wsManager,
    orderRepository
  );
  logger.info('Fastify Server initialized');

  return {
    config,
    orderRepository,
    orderCache,
    dexRouter,
    orderExecutor,
    orderQueue,
    orderProcessor,
    wsManager,
    fastifyServer
  };
}

/**
 * Graceful shutdown handler
 * Closes all connections and stops all services
 */
async function gracefulShutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Received shutdown signal, starting graceful shutdown...');

  if (!appContainer) {
    logger.info('No active application container, exiting immediately');
    process.exit(0);
  }

  try {
    // Stop accepting new requests
    logger.info('Stopping Fastify server...');
    await appContainer.fastifyServer.stop();

    // Pause queue to stop processing new jobs
    logger.info('Pausing order queue...');
    await appContainer.orderQueue.pause();

    // Wait for active jobs to complete (with timeout)
    logger.info('Waiting for active jobs to complete...');
    const waitForJobs = async () => {
      const maxWaitTime = 30000; // 30 seconds
      const startTime = Date.now();
      
      while (Date.now() - startTime < maxWaitTime) {
        const metrics = await appContainer!.orderQueue.getMetrics();
        if (metrics.active === 0) {
          logger.info('All active jobs completed');
          return;
        }
        logger.info({ activeJobs: metrics.active }, 'Waiting for active jobs...');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      logger.warn('Timeout waiting for jobs to complete, proceeding with shutdown');
    };
    
    await waitForJobs();

    // Close order processor worker
    logger.info('Closing order processor...');
    await appContainer.orderProcessor.close();

    // Close order queue
    logger.info('Closing order queue...');
    await appContainer.orderQueue.close();

    // Close database connections
    logger.info('Closing database connections...');
    await closePool();

    // Close Redis connections
    logger.info('Closing Redis connections...');
    await closeRedis();

    logger.info('Graceful shutdown completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Error during graceful shutdown');
    process.exit(1);
  }
}

/**
 * Main application entry point
 */
async function main() {
  try {
    logger.info('DEX Order Execution Engine starting...');

    // Initialize all components
    appContainer = await initializeComponents();

    logger.info({
      host: appContainer.config.HOST,
      port: appContainer.config.PORT,
      dexImplementation: appContainer.config.DEX_IMPLEMENTATION,
      queueConcurrency: appContainer.config.QUEUE_CONCURRENCY
    }, 'All components initialized successfully');

    // Start Fastify server
    await appContainer.fastifyServer.start();

    logger.info('DEX Order Execution Engine is ready and accepting requests');
    logger.info(`Health check available at: http://${appContainer.config.HOST}:${appContainer.config.PORT}/health`);
    logger.info(`Order submission endpoint: http://${appContainer.config.HOST}:${appContainer.config.PORT}/api/orders/execute`);

    // Register shutdown handlers
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    logger.error({ error }, 'Failed to start DEX Order Execution Engine');
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error({ error }, 'Uncaught exception');
  gracefulShutdown('uncaughtException');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled promise rejection');
  gracefulShutdown('unhandledRejection');
});

main();
