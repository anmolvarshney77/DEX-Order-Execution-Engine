import { loadConfig } from '@config/env';
import { logger } from '@utils/logger';

async function main() {
  try {
    const config = loadConfig();
    logger.info({ config: { ...config, POSTGRES_PASSWORD: '***', REDIS_PASSWORD: '***' } }, 'Configuration loaded');
    
    logger.info('DEX Order Execution Engine starting...');
    logger.info(`Server will run on ${config.HOST}:${config.PORT}`);
    logger.info(`DEX Implementation: ${config.DEX_IMPLEMENTATION}`);
    
    // TODO: Initialize components in subsequent tasks
    // - Database connections
    // - Redis connections
    // - BullMQ queue
    // - Fastify server
    
    logger.info('DEX Order Execution Engine ready');
  } catch (error) {
    logger.error({ error }, 'Failed to start DEX Order Execution Engine');
    process.exit(1);
  }
}

main();
