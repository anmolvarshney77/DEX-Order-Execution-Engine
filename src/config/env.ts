import dotenv from 'dotenv';

dotenv.config();

export interface EnvironmentConfig {
  // Server Configuration
  PORT: number;
  HOST: string;
  NODE_ENV: 'development' | 'production' | 'test';
  
  // Redis Configuration
  REDIS_HOST: string;
  REDIS_PORT: number;
  REDIS_PASSWORD?: string;
  REDIS_DB: number;
  REDIS_TTL: number;
  
  // PostgreSQL Configuration
  POSTGRES_HOST: string;
  POSTGRES_PORT: number;
  POSTGRES_USER: string;
  POSTGRES_PASSWORD: string;
  POSTGRES_DATABASE: string;
  POSTGRES_MAX_CONNECTIONS: number;
  
  // Queue Configuration
  QUEUE_CONCURRENCY: number;
  QUEUE_MAX_RETRIES: number;
  QUEUE_BACKOFF_DELAY: number;
  QUEUE_MAX_THROUGHPUT: number;
  
  // DEX Configuration
  DEX_QUOTE_TIMEOUT: number;
  DEX_IMPLEMENTATION: 'mock' | 'real';
  
  // Solana Configuration (for real implementation)
  SOLANA_RPC_URL?: string;
  SOLANA_CLUSTER?: 'devnet' | 'mainnet-beta';
  SOLANA_WALLET_PRIVATE_KEY?: string;
  
  // Slippage Configuration
  DEFAULT_SLIPPAGE: number;
  MAX_SLIPPAGE: number;
  
  // Monitoring Configuration
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
  ENABLE_METRICS: boolean;
}

function validateConfig(config: Partial<EnvironmentConfig>): void {
  const errors: string[] = [];

  // Validate required fields
  if (!config.PORT || config.PORT < 1 || config.PORT > 65535) {
    errors.push('PORT must be between 1 and 65535');
  }

  if (!config.REDIS_HOST) {
    errors.push('REDIS_HOST is required');
  }

  if (!config.POSTGRES_HOST) {
    errors.push('POSTGRES_HOST is required');
  }

  if (!config.POSTGRES_USER) {
    errors.push('POSTGRES_USER is required');
  }

  if (!config.POSTGRES_PASSWORD) {
    errors.push('POSTGRES_PASSWORD is required');
  }

  if (!config.POSTGRES_DATABASE) {
    errors.push('POSTGRES_DATABASE is required');
  }

  if (config.DEFAULT_SLIPPAGE && (config.DEFAULT_SLIPPAGE < 0 || config.DEFAULT_SLIPPAGE > 1)) {
    errors.push('DEFAULT_SLIPPAGE must be between 0 and 1');
  }

  if (config.MAX_SLIPPAGE && (config.MAX_SLIPPAGE < 0 || config.MAX_SLIPPAGE > 1)) {
    errors.push('MAX_SLIPPAGE must be between 0 and 1');
  }

  if (config.DEX_IMPLEMENTATION && !['mock', 'real'].includes(config.DEX_IMPLEMENTATION)) {
    errors.push('DEX_IMPLEMENTATION must be either "mock" or "real"');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}

export function loadConfig(): EnvironmentConfig {
  const config: EnvironmentConfig = {
    // Server Configuration
    PORT: parseInt(process.env.PORT || '3000', 10),
    HOST: process.env.HOST || '0.0.0.0',
    NODE_ENV: (process.env.NODE_ENV as EnvironmentConfig['NODE_ENV']) || 'development',
    
    // Redis Configuration
    REDIS_HOST: process.env.REDIS_HOST || 'localhost',
    REDIS_PORT: parseInt(process.env.REDIS_PORT || '6379', 10),
    REDIS_PASSWORD: process.env.REDIS_PASSWORD,
    REDIS_DB: parseInt(process.env.REDIS_DB || '0', 10),
    REDIS_TTL: parseInt(process.env.REDIS_TTL || '3600', 10),
    
    // PostgreSQL Configuration
    POSTGRES_HOST: process.env.POSTGRES_HOST || 'localhost',
    POSTGRES_PORT: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    POSTGRES_USER: process.env.POSTGRES_USER || 'postgres',
    POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD || 'postgres',
    POSTGRES_DATABASE: process.env.POSTGRES_DATABASE || 'dex_orders',
    POSTGRES_MAX_CONNECTIONS: parseInt(process.env.POSTGRES_MAX_CONNECTIONS || '20', 10),
    
    // Queue Configuration
    QUEUE_CONCURRENCY: parseInt(process.env.QUEUE_CONCURRENCY || '10', 10),
    QUEUE_MAX_RETRIES: parseInt(process.env.QUEUE_MAX_RETRIES || '3', 10),
    QUEUE_BACKOFF_DELAY: parseInt(process.env.QUEUE_BACKOFF_DELAY || '1000', 10),
    QUEUE_MAX_THROUGHPUT: parseInt(process.env.QUEUE_MAX_THROUGHPUT || '100', 10),
    
    // DEX Configuration
    DEX_QUOTE_TIMEOUT: parseInt(process.env.DEX_QUOTE_TIMEOUT || '5000', 10),
    DEX_IMPLEMENTATION: (process.env.DEX_IMPLEMENTATION as EnvironmentConfig['DEX_IMPLEMENTATION']) || 'mock',
    
    // Solana Configuration
    SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
    SOLANA_CLUSTER: (process.env.SOLANA_CLUSTER as EnvironmentConfig['SOLANA_CLUSTER']) || 'devnet',
    SOLANA_WALLET_PRIVATE_KEY: process.env.SOLANA_WALLET_PRIVATE_KEY,
    
    // Slippage Configuration
    DEFAULT_SLIPPAGE: parseFloat(process.env.DEFAULT_SLIPPAGE || '0.01'),
    MAX_SLIPPAGE: parseFloat(process.env.MAX_SLIPPAGE || '0.1'),
    
    // Monitoring Configuration
    LOG_LEVEL: (process.env.LOG_LEVEL as EnvironmentConfig['LOG_LEVEL']) || 'info',
    ENABLE_METRICS: process.env.ENABLE_METRICS === 'true'
  };

  validateConfig(config);

  return config;
}
