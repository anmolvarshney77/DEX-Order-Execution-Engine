import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, resetConfig, getConfig, type EnvironmentConfig } from './env';

describe('Configuration Management', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset configuration before each test
    resetConfig();
    // Create a fresh copy of environment variables
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    resetConfig();
  });

  describe('loadConfig', () => {
    it('should load configuration with default values', () => {
      const config = loadConfig();

      expect(config.PORT).toBe(3000);
      expect(config.HOST).toBe('0.0.0.0');
      // NODE_ENV is set to 'test' by Vitest
      expect(config.NODE_ENV).toBe('test');
      expect(config.REDIS_HOST).toBe('localhost');
      expect(config.REDIS_PORT).toBe(6379);
      expect(config.POSTGRES_HOST).toBe('localhost');
      expect(config.QUEUE_CONCURRENCY).toBe(10);
      expect(config.DEX_IMPLEMENTATION).toBe('mock');
      expect(config.DEFAULT_SLIPPAGE).toBe(0.01);
      expect(config.MAX_SLIPPAGE).toBe(0.1);
    });

    it('should override defaults with environment variables', () => {
      process.env.PORT = '8080';
      process.env.REDIS_HOST = 'redis.example.com';
      process.env.QUEUE_CONCURRENCY = '20';
      process.env.DEX_IMPLEMENTATION = 'real';
      process.env.SOLANA_RPC_URL = 'https://api.devnet.solana.com';
      process.env.SOLANA_WALLET_PRIVATE_KEY = 'test_key';

      const config = loadConfig();

      expect(config.PORT).toBe(8080);
      expect(config.REDIS_HOST).toBe('redis.example.com');
      expect(config.QUEUE_CONCURRENCY).toBe(20);
      expect(config.DEX_IMPLEMENTATION).toBe('real');
    });

    it('should validate port range', () => {
      process.env.PORT = '70000';

      expect(() => loadConfig()).toThrow('PORT must be between 1 and 65535');
    });

    it('should validate negative port', () => {
      process.env.PORT = '-1';

      expect(() => loadConfig()).toThrow('PORT must be between 1 and 65535');
    });

    it('should validate invalid integer values', () => {
      process.env.QUEUE_CONCURRENCY = 'not_a_number';

      expect(() => loadConfig()).toThrow('Invalid integer value for QUEUE_CONCURRENCY');
    });

    it('should validate invalid float values', () => {
      process.env.DEFAULT_SLIPPAGE = 'invalid';

      expect(() => loadConfig()).toThrow('Invalid float value for DEFAULT_SLIPPAGE');
    });

    it('should validate NODE_ENV enum values', () => {
      process.env.NODE_ENV = 'invalid_env';

      expect(() => loadConfig()).toThrow('Invalid value for NODE_ENV');
    });

    it('should validate DEX_IMPLEMENTATION enum values', () => {
      process.env.DEX_IMPLEMENTATION = 'invalid_dex';

      expect(() => loadConfig()).toThrow('Invalid value for DEX_IMPLEMENTATION');
    });

    it('should validate slippage range', () => {
      process.env.DEFAULT_SLIPPAGE = '1.5';

      expect(() => loadConfig()).toThrow('DEFAULT_SLIPPAGE must be between 0 and 1');
    });

    it('should validate DEFAULT_SLIPPAGE does not exceed MAX_SLIPPAGE', () => {
      process.env.DEFAULT_SLIPPAGE = '0.2';
      process.env.MAX_SLIPPAGE = '0.1';

      expect(() => loadConfig()).toThrow('DEFAULT_SLIPPAGE');
    });

    it('should require SOLANA_RPC_URL for real implementation', () => {
      process.env.DEX_IMPLEMENTATION = 'real';
      process.env.SOLANA_WALLET_PRIVATE_KEY = 'test_key';

      expect(() => loadConfig()).toThrow('SOLANA_RPC_URL is required');
    });

    it('should require SOLANA_WALLET_PRIVATE_KEY for real implementation', () => {
      process.env.DEX_IMPLEMENTATION = 'real';
      process.env.SOLANA_RPC_URL = 'https://api.devnet.solana.com';

      expect(() => loadConfig()).toThrow('SOLANA_WALLET_PRIVATE_KEY is required');
    });

    it('should validate queue concurrency is positive', () => {
      process.env.QUEUE_CONCURRENCY = '0';

      expect(() => loadConfig()).toThrow('QUEUE_CONCURRENCY must be at least 1');
    });

    it('should validate queue max retries is non-negative', () => {
      process.env.QUEUE_MAX_RETRIES = '-1';

      expect(() => loadConfig()).toThrow('QUEUE_MAX_RETRIES must be non-negative');
    });
  });

  describe('getConfig', () => {
    it('should return singleton instance', () => {
      const config1 = getConfig();
      const config2 = getConfig();

      expect(config1).toBe(config2);
    });

    it('should return new instance after reset', () => {
      const config1 = getConfig();
      resetConfig();
      const config2 = getConfig();

      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
    });
  });

  describe('Configuration injection pattern', () => {
    it('should support dependency injection for components', () => {
      const config = loadConfig();

      // Example: Queue service configuration
      const queueConfig = {
        concurrency: config.QUEUE_CONCURRENCY,
        maxRetries: config.QUEUE_MAX_RETRIES,
        backoffDelay: config.QUEUE_BACKOFF_DELAY
      };

      expect(queueConfig.concurrency).toBe(10);
      expect(queueConfig.maxRetries).toBe(3);
      expect(queueConfig.backoffDelay).toBe(1000);
    });

    it('should support partial configuration extraction', () => {
      const config = loadConfig();

      // Example: DEX router configuration
      const dexConfig = {
        implementation: config.DEX_IMPLEMENTATION,
        quoteTimeout: config.DEX_QUOTE_TIMEOUT
      };

      expect(dexConfig.implementation).toBe('mock');
      expect(dexConfig.quoteTimeout).toBe(5000);
    });
  });
});
