import dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables from .env file
dotenv.config({ path: resolve(process.cwd(), '.env') });

/**
 * Environment configuration interface
 * Defines all configuration options for the DEX Order Execution Engine
 */
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
  REDIS_TTL: number; // Cache TTL in seconds
  
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
  QUEUE_MAX_THROUGHPUT: number; // Orders per minute
  
  // DEX Configuration
  DEX_QUOTE_TIMEOUT: number; // Timeout in milliseconds
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

/**
 * Parses an integer from environment variable with validation
 * @param key - Environment variable name
 * @param value - Environment variable value
 * @param defaultValue - Default value if not provided
 * @returns Parsed integer value
 */
function parseIntEnv(key: string, value: string | undefined, defaultValue: number): number {
  if (!value) {
    return defaultValue;
  }
  
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Invalid integer value for ${key}: ${value}`);
  }
  
  return parsed;
}

/**
 * Parses a float from environment variable with validation
 * @param key - Environment variable name
 * @param value - Environment variable value
 * @param defaultValue - Default value if not provided
 * @returns Parsed float value
 */
function parseFloatEnv(key: string, value: string | undefined, defaultValue: number): number {
  if (!value) {
    return defaultValue;
  }
  
  const parsed = parseFloat(value);
  if (isNaN(parsed)) {
    throw new Error(`Invalid float value for ${key}: ${value}`);
  }
  
  return parsed;
}

/**
 * Validates enum value against allowed options
 * @param key - Environment variable name
 * @param value - Environment variable value
 * @param allowedValues - Array of allowed values
 * @param defaultValue - Default value if not provided
 * @returns Validated enum value
 */
function parseEnumEnv<T extends string>(
  key: string,
  value: string | undefined,
  allowedValues: readonly T[],
  defaultValue: T
): T {
  if (!value) {
    return defaultValue;
  }
  
  if (!allowedValues.includes(value as T)) {
    throw new Error(
      `Invalid value for ${key}: ${value}. Allowed values: ${allowedValues.join(', ')}`
    );
  }
  
  return value as T;
}

/**
 * Loads and validates environment configuration
 * @returns Validated EnvironmentConfig object
 * @throws Error if required variables are missing or invalid
 */
export function loadConfig(): EnvironmentConfig {
  const config: EnvironmentConfig = {
    // Server Configuration
    PORT: parseIntEnv('PORT', process.env.PORT, 3000),
    HOST: process.env.HOST || '0.0.0.0',
    NODE_ENV: parseEnumEnv(
      'NODE_ENV',
      process.env.NODE_ENV,
      ['development', 'production', 'test'] as const,
      'development'
    ),
    
    // Redis Configuration
    REDIS_HOST: process.env.REDIS_HOST || 'localhost',
    REDIS_PORT: parseIntEnv('REDIS_PORT', process.env.REDIS_PORT, 6379),
    REDIS_PASSWORD: process.env.REDIS_PASSWORD,
    REDIS_DB: parseIntEnv('REDIS_DB', process.env.REDIS_DB, 0),
    REDIS_TTL: parseIntEnv('REDIS_TTL', process.env.REDIS_TTL, 3600),
    
    // PostgreSQL Configuration
    POSTGRES_HOST: process.env.POSTGRES_HOST || 'localhost',
    POSTGRES_PORT: parseIntEnv('POSTGRES_PORT', process.env.POSTGRES_PORT, 5432),
    POSTGRES_USER: process.env.POSTGRES_USER || 'postgres',
    POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD || 'postgres',
    POSTGRES_DATABASE: process.env.POSTGRES_DATABASE || 'dex_orders',
    POSTGRES_MAX_CONNECTIONS: parseIntEnv(
      'POSTGRES_MAX_CONNECTIONS',
      process.env.POSTGRES_MAX_CONNECTIONS,
      20
    ),
    
    // Queue Configuration
    QUEUE_CONCURRENCY: parseIntEnv('QUEUE_CONCURRENCY', process.env.QUEUE_CONCURRENCY, 10),
    QUEUE_MAX_RETRIES: parseIntEnv('QUEUE_MAX_RETRIES', process.env.QUEUE_MAX_RETRIES, 3),
    QUEUE_BACKOFF_DELAY: parseIntEnv('QUEUE_BACKOFF_DELAY', process.env.QUEUE_BACKOFF_DELAY, 1000),
    QUEUE_MAX_THROUGHPUT: parseIntEnv(
      'QUEUE_MAX_THROUGHPUT',
      process.env.QUEUE_MAX_THROUGHPUT,
      100
    ),
    
    // DEX Configuration
    DEX_QUOTE_TIMEOUT: parseIntEnv('DEX_QUOTE_TIMEOUT', process.env.DEX_QUOTE_TIMEOUT, 5000),
    DEX_IMPLEMENTATION: parseEnumEnv(
      'DEX_IMPLEMENTATION',
      process.env.DEX_IMPLEMENTATION,
      ['mock', 'real'] as const,
      'mock'
    ),
    
    // Solana Configuration (optional for mock implementation)
    SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
    SOLANA_CLUSTER: process.env.SOLANA_CLUSTER
      ? parseEnumEnv(
          'SOLANA_CLUSTER',
          process.env.SOLANA_CLUSTER,
          ['devnet', 'mainnet-beta'] as const,
          'devnet'
        )
      : undefined,
    SOLANA_WALLET_PRIVATE_KEY: process.env.SOLANA_WALLET_PRIVATE_KEY,
    
    // Slippage Configuration
    DEFAULT_SLIPPAGE: parseFloatEnv('DEFAULT_SLIPPAGE', process.env.DEFAULT_SLIPPAGE, 0.01),
    MAX_SLIPPAGE: parseFloatEnv('MAX_SLIPPAGE', process.env.MAX_SLIPPAGE, 0.1),
    
    // Monitoring Configuration
    LOG_LEVEL: parseEnumEnv(
      'LOG_LEVEL',
      process.env.LOG_LEVEL,
      ['debug', 'info', 'warn', 'error'] as const,
      'info'
    ),
    ENABLE_METRICS: process.env.ENABLE_METRICS === 'true'
  };
  
  // Validate configuration constraints
  validateConfig(config);
  
  return config;
}

/**
 * Validates configuration constraints and business rules
 * @param config - Configuration object to validate
 * @throws Error if validation fails
 */
function validateConfig(config: EnvironmentConfig): void {
  // Validate port range
  if (config.PORT < 1 || config.PORT > 65535) {
    throw new Error(`PORT must be between 1 and 65535, got: ${config.PORT}`);
  }
  
  // Validate Redis port
  if (config.REDIS_PORT < 1 || config.REDIS_PORT > 65535) {
    throw new Error(`REDIS_PORT must be between 1 and 65535, got: ${config.REDIS_PORT}`);
  }
  
  // Validate PostgreSQL port
  if (config.POSTGRES_PORT < 1 || config.POSTGRES_PORT > 65535) {
    throw new Error(`POSTGRES_PORT must be between 1 and 65535, got: ${config.POSTGRES_PORT}`);
  }
  
  // Validate queue concurrency
  if (config.QUEUE_CONCURRENCY < 1) {
    throw new Error(`QUEUE_CONCURRENCY must be at least 1, got: ${config.QUEUE_CONCURRENCY}`);
  }
  
  // Validate queue max retries
  if (config.QUEUE_MAX_RETRIES < 0) {
    throw new Error(`QUEUE_MAX_RETRIES must be non-negative, got: ${config.QUEUE_MAX_RETRIES}`);
  }
  
  // Validate queue backoff delay
  if (config.QUEUE_BACKOFF_DELAY < 0) {
    throw new Error(`QUEUE_BACKOFF_DELAY must be non-negative, got: ${config.QUEUE_BACKOFF_DELAY}`);
  }
  
  // Validate slippage values
  if (config.DEFAULT_SLIPPAGE < 0 || config.DEFAULT_SLIPPAGE > 1) {
    throw new Error(`DEFAULT_SLIPPAGE must be between 0 and 1, got: ${config.DEFAULT_SLIPPAGE}`);
  }
  
  if (config.MAX_SLIPPAGE < 0 || config.MAX_SLIPPAGE > 1) {
    throw new Error(`MAX_SLIPPAGE must be between 0 and 1, got: ${config.MAX_SLIPPAGE}`);
  }
  
  if (config.DEFAULT_SLIPPAGE > config.MAX_SLIPPAGE) {
    throw new Error(
      `DEFAULT_SLIPPAGE (${config.DEFAULT_SLIPPAGE}) cannot exceed MAX_SLIPPAGE (${config.MAX_SLIPPAGE})`
    );
  }
  
  // Validate real implementation requirements
  if (config.DEX_IMPLEMENTATION === 'real') {
    if (!config.SOLANA_RPC_URL) {
      throw new Error('SOLANA_RPC_URL is required when DEX_IMPLEMENTATION is "real"');
    }
    if (!config.SOLANA_WALLET_PRIVATE_KEY) {
      throw new Error('SOLANA_WALLET_PRIVATE_KEY is required when DEX_IMPLEMENTATION is "real"');
    }
  }
}

/**
 * Singleton instance of configuration
 * Loaded once and reused throughout the application
 */
let configInstance: EnvironmentConfig | null = null;

/**
 * Gets the configuration instance (singleton pattern)
 * @returns EnvironmentConfig instance
 */
export function getConfig(): EnvironmentConfig {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

/**
 * Resets the configuration instance (useful for testing)
 */
export function resetConfig(): void {
  configInstance = null;
}
