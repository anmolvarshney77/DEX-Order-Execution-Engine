import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DexRouter } from './DexRouter';
import { DexClient } from './DexClient';
import { DexQuote } from '../types';

// Mock logger to avoid console output during tests
vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn()
  }
}));

describe('DexRouter', () => {
  let mockRaydiumClient: DexClient;
  let mockMeteoraClient: DexClient;
  let router: DexRouter;

  beforeEach(() => {
    // Create mock clients
    mockRaydiumClient = {
      getQuote: vi.fn(),
      executeSwap: vi.fn()
    };

    mockMeteoraClient = {
      getQuote: vi.fn(),
      executeSwap: vi.fn()
    };

    router = new DexRouter(mockRaydiumClient, mockMeteoraClient, { quoteTimeout: 5000 });
  });

  describe('getQuotes', () => {
    it('should fetch quotes from both DEXs in parallel', async () => {
      const raydiumQuote: DexQuote = {
        dex: 'raydium',
        price: 1.0,
        fee: 0.0025,
        effectivePrice: 0.9975,
        estimatedOutput: 1000,
        poolId: 'raydium-pool-1'
      };

      const meteoraQuote: DexQuote = {
        dex: 'meteora',
        price: 1.01,
        fee: 0.002,
        effectivePrice: 1.0098,
        estimatedOutput: 1010,
        poolId: 'meteora-pool-1'
      };

      vi.mocked(mockRaydiumClient.getQuote).mockResolvedValue(raydiumQuote);
      vi.mocked(mockMeteoraClient.getQuote).mockResolvedValue(meteoraQuote);

      const quotes = await router.getQuotes('tokenA', 'tokenB', 1000);

      expect(quotes).toHaveLength(2);
      expect(quotes).toContainEqual(raydiumQuote);
      expect(quotes).toContainEqual(meteoraQuote);
      expect(mockRaydiumClient.getQuote).toHaveBeenCalledWith('tokenA', 'tokenB', 1000);
      expect(mockMeteoraClient.getQuote).toHaveBeenCalledWith('tokenA', 'tokenB', 1000);
    });

    it('should return quotes even if one DEX fails', async () => {
      const meteoraQuote: DexQuote = {
        dex: 'meteora',
        price: 1.01,
        fee: 0.002,
        effectivePrice: 1.0098,
        estimatedOutput: 1010,
        poolId: 'meteora-pool-1'
      };

      vi.mocked(mockRaydiumClient.getQuote).mockRejectedValue(new Error('Raydium unavailable'));
      vi.mocked(mockMeteoraClient.getQuote).mockResolvedValue(meteoraQuote);

      const quotes = await router.getQuotes('tokenA', 'tokenB', 1000);

      expect(quotes).toHaveLength(1);
      expect(quotes[0]).toEqual(meteoraQuote);
    });

    it('should throw error if all DEXs fail', async () => {
      vi.mocked(mockRaydiumClient.getQuote).mockRejectedValue(new Error('Raydium unavailable'));
      vi.mocked(mockMeteoraClient.getQuote).mockRejectedValue(new Error('Meteora unavailable'));

      await expect(router.getQuotes('tokenA', 'tokenB', 1000)).rejects.toThrow('Failed to get quotes from any DEX');
    });

    it('should handle wrapped SOL conversion for tokenIn', async () => {
      const raydiumQuote: DexQuote = {
        dex: 'raydium',
        price: 1.0,
        fee: 0.0025,
        effectivePrice: 0.9975,
        estimatedOutput: 1000,
        poolId: 'raydium-pool-1'
      };

      vi.mocked(mockRaydiumClient.getQuote).mockResolvedValue(raydiumQuote);
      vi.mocked(mockMeteoraClient.getQuote).mockResolvedValue(raydiumQuote);

      await router.getQuotes('SOL', 'tokenB', 1000);

      // Should call with wrapped SOL address
      expect(mockRaydiumClient.getQuote).toHaveBeenCalledWith(
        'So11111111111111111111111111111111111111112',
        'tokenB',
        1000
      );
    });

    it('should handle wrapped SOL conversion for tokenOut', async () => {
      const raydiumQuote: DexQuote = {
        dex: 'raydium',
        price: 1.0,
        fee: 0.0025,
        effectivePrice: 0.9975,
        estimatedOutput: 1000,
        poolId: 'raydium-pool-1'
      };

      vi.mocked(mockRaydiumClient.getQuote).mockResolvedValue(raydiumQuote);
      vi.mocked(mockMeteoraClient.getQuote).mockResolvedValue(raydiumQuote);

      await router.getQuotes('tokenA', 'SOL', 1000);

      // Should call with wrapped SOL address
      expect(mockRaydiumClient.getQuote).toHaveBeenCalledWith(
        'tokenA',
        'So11111111111111111111111111111111111111112',
        1000
      );
    });
  });

  describe('selectBestDex', () => {
    it('should select DEX with higher effective price', () => {
      const raydiumQuote: DexQuote = {
        dex: 'raydium',
        price: 1.0,
        fee: 0.0025,
        effectivePrice: 0.9975,
        estimatedOutput: 997.5,
        poolId: 'raydium-pool-1'
      };

      const meteoraQuote: DexQuote = {
        dex: 'meteora',
        price: 1.01,
        fee: 0.002,
        effectivePrice: 1.0098,
        estimatedOutput: 1009.8,
        poolId: 'meteora-pool-1'
      };

      const bestQuote = router.selectBestDex([raydiumQuote, meteoraQuote]);

      expect(bestQuote).toEqual(meteoraQuote);
      expect(bestQuote.dex).toBe('meteora');
    });

    it('should select Raydium when it has better effective price', () => {
      const raydiumQuote: DexQuote = {
        dex: 'raydium',
        price: 1.05,
        fee: 0.0025,
        effectivePrice: 1.04738,
        estimatedOutput: 1047.38,
        poolId: 'raydium-pool-1'
      };

      const meteoraQuote: DexQuote = {
        dex: 'meteora',
        price: 1.01,
        fee: 0.002,
        effectivePrice: 1.0098,
        estimatedOutput: 1009.8,
        poolId: 'meteora-pool-1'
      };

      const bestQuote = router.selectBestDex([raydiumQuote, meteoraQuote]);

      expect(bestQuote).toEqual(raydiumQuote);
      expect(bestQuote.dex).toBe('raydium');
    });

    it('should handle single quote', () => {
      const raydiumQuote: DexQuote = {
        dex: 'raydium',
        price: 1.0,
        fee: 0.0025,
        effectivePrice: 0.9975,
        estimatedOutput: 997.5,
        poolId: 'raydium-pool-1'
      };

      const bestQuote = router.selectBestDex([raydiumQuote]);

      expect(bestQuote).toEqual(raydiumQuote);
    });

    it('should throw error for empty quotes array', () => {
      expect(() => router.selectBestDex([])).toThrow('No quotes available for comparison');
    });

    it('should correctly compare effective prices accounting for fees', () => {
      // Raydium: higher base price but higher fee
      const raydiumQuote: DexQuote = {
        dex: 'raydium',
        price: 1.00,
        fee: 0.003,
        effectivePrice: 1.00 * (1 - 0.003), // 0.997
        estimatedOutput: 997,
        poolId: 'raydium-pool-1'
      };

      // Meteora: lower base price but lower fee
      const meteoraQuote: DexQuote = {
        dex: 'meteora',
        price: 0.999,
        fee: 0.001,
        effectivePrice: 0.999 * (1 - 0.001), // 0.998001
        estimatedOutput: 998.001,
        poolId: 'meteora-pool-1'
      };

      const bestQuote = router.selectBestDex([raydiumQuote, meteoraQuote]);

      // Meteora should win despite lower base price due to lower fees
      expect(bestQuote.dex).toBe('meteora');
    });
  });

  describe('handleWrappedSol', () => {
    it('should convert "SOL" to wrapped SOL mint address', () => {
      const result = router.handleWrappedSol('SOL');
      expect(result).toBe('So11111111111111111111111111111111111111112');
    });

    it('should convert "sol" (lowercase) to wrapped SOL mint address', () => {
      const result = router.handleWrappedSol('sol');
      expect(result).toBe('So11111111111111111111111111111111111111112');
    });

    it('should return original address for non-SOL tokens', () => {
      const tokenAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      const result = router.handleWrappedSol(tokenAddress);
      expect(result).toBe(tokenAddress);
    });

    it('should handle mixed case SOL', () => {
      const result = router.handleWrappedSol('SoL');
      expect(result).toBe('So11111111111111111111111111111111111111112');
    });
  });

  describe('quote timeout', () => {
    it('should timeout slow DEX requests', async () => {
      const meteoraQuote: DexQuote = {
        dex: 'meteora',
        price: 1.01,
        fee: 0.002,
        effectivePrice: 1.0098,
        estimatedOutput: 1010,
        poolId: 'meteora-pool-1'
      };

      // Raydium takes too long
      vi.mocked(mockRaydiumClient.getQuote).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({} as DexQuote), 10000))
      );
      vi.mocked(mockMeteoraClient.getQuote).mockResolvedValue(meteoraQuote);

      const routerWithShortTimeout = new DexRouter(
        mockRaydiumClient,
        mockMeteoraClient,
        { quoteTimeout: 100 }
      );

      const quotes = await routerWithShortTimeout.getQuotes('tokenA', 'tokenB', 1000);

      // Should only get Meteora quote since Raydium timed out
      expect(quotes).toHaveLength(1);
      expect(quotes[0].dex).toBe('meteora');
    });
  });
});
