import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrderExecutor } from './OrderExecutor';
import { DexClient } from '../routing/DexClient';
import { DexQuote, SwapParams, SwapResult } from '../types';

describe('OrderExecutor', () => {
  let mockRaydiumClient: DexClient;
  let mockMeteoraClient: DexClient;
  let executor: OrderExecutor;

  beforeEach(() => {
    // Create mock DEX clients
    mockRaydiumClient = {
      getQuote: vi.fn(),
      executeSwap: vi.fn()
    };

    mockMeteoraClient = {
      getQuote: vi.fn(),
      executeSwap: vi.fn()
    };

    executor = new OrderExecutor(mockRaydiumClient, mockMeteoraClient, {
      defaultSlippage: 0.01,
      maxSlippage: 0.1
    });
  });

  describe('executeSwap', () => {
    const mockQuote: DexQuote = {
      dex: 'raydium',
      price: 1.0,
      fee: 0.0025,
      effectivePrice: 0.9975,
      poolId: 'test-pool',
      estimatedOutput: 1000
    };

    const mockSwapResult: SwapResult = {
      txHash: 'mock-tx-hash-123',
      executedPrice: 0.998,
      inputAmount: 1000,
      outputAmount: 998,
      fee: 2.5,
      timestamp: Date.now()
    };

    it('should execute swap on Raydium with correct parameters', async () => {
      vi.mocked(mockRaydiumClient.executeSwap).mockResolvedValue(mockSwapResult);

      const result = await executor.executeSwap(
        mockQuote,
        'token-in',
        'token-out',
        1000,
        0.01
      );

      expect(mockRaydiumClient.executeSwap).toHaveBeenCalledWith({
        dex: 'raydium',
        tokenIn: 'token-in',
        tokenOut: 'token-out',
        amount: 1000,
        minAmountOut: 990, // 1000 * (1 - 0.01) = 990
        poolId: 'test-pool'
      });

      expect(result).toEqual(mockSwapResult);
    });

    it('should execute swap on Meteora with correct parameters', async () => {
      const meteoraQuote: DexQuote = {
        ...mockQuote,
        dex: 'meteora'
      };

      vi.mocked(mockMeteoraClient.executeSwap).mockResolvedValue(mockSwapResult);

      await executor.executeSwap(
        meteoraQuote,
        'token-in',
        'token-out',
        1000,
        0.01
      );

      expect(mockMeteoraClient.executeSwap).toHaveBeenCalledWith({
        dex: 'meteora',
        tokenIn: 'token-in',
        tokenOut: 'token-out',
        amount: 1000,
        minAmountOut: 990,
        poolId: 'test-pool'
      });
    });

    it('should use default slippage when not provided', async () => {
      vi.mocked(mockRaydiumClient.executeSwap).mockResolvedValue(mockSwapResult);

      await executor.executeSwap(
        mockQuote,
        'token-in',
        'token-out',
        1000
      );

      expect(mockRaydiumClient.executeSwap).toHaveBeenCalledWith(
        expect.objectContaining({
          minAmountOut: 990 // Using default 1% slippage
        })
      );
    });

    it('should calculate minAmountOut correctly with different slippage values', async () => {
      vi.mocked(mockRaydiumClient.executeSwap).mockResolvedValue(mockSwapResult);

      // Test with 5% slippage
      await executor.executeSwap(
        mockQuote,
        'token-in',
        'token-out',
        1000,
        0.05
      );

      expect(mockRaydiumClient.executeSwap).toHaveBeenCalledWith(
        expect.objectContaining({
          minAmountOut: 950 // 1000 * (1 - 0.05) = 950
        })
      );
    });

    it('should floor minAmountOut to avoid fractional tokens', async () => {
      const quoteWithFractional: DexQuote = {
        ...mockQuote,
        estimatedOutput: 1005 // Will result in 994.95 with 1% slippage
      };

      vi.mocked(mockRaydiumClient.executeSwap).mockResolvedValue(mockSwapResult);

      await executor.executeSwap(
        quoteWithFractional,
        'token-in',
        'token-out',
        1000,
        0.01
      );

      expect(mockRaydiumClient.executeSwap).toHaveBeenCalledWith(
        expect.objectContaining({
          minAmountOut: 994 // Floor of 994.95
        })
      );
    });

    it('should reject slippage values above maximum', async () => {
      await expect(
        executor.executeSwap(
          mockQuote,
          'token-in',
          'token-out',
          1000,
          0.15 // 15% exceeds max of 10%
        )
      ).rejects.toThrow('Slippage 0.15 is outside acceptable range');
    });

    it('should reject negative slippage values', async () => {
      await expect(
        executor.executeSwap(
          mockQuote,
          'token-in',
          'token-out',
          1000,
          -0.01
        )
      ).rejects.toThrow('Slippage -0.01 is outside acceptable range');
    });

    it('should handle slippage tolerance exceeded error', async () => {
      vi.mocked(mockRaydiumClient.executeSwap).mockRejectedValue(
        new Error('Slippage tolerance exceeded: expected at least 990, got 980')
      );

      await expect(
        executor.executeSwap(
          mockQuote,
          'token-in',
          'token-out',
          1000,
          0.01
        )
      ).rejects.toThrow('Slippage tolerance exceeded on raydium');
    });

    it('should propagate other execution errors', async () => {
      vi.mocked(mockRaydiumClient.executeSwap).mockRejectedValue(
        new Error('Network error')
      );

      await expect(
        executor.executeSwap(
          mockQuote,
          'token-in',
          'token-out',
          1000,
          0.01
        )
      ).rejects.toThrow('Network error');
    });

    it('should return execution result with all required fields', async () => {
      vi.mocked(mockRaydiumClient.executeSwap).mockResolvedValue(mockSwapResult);

      const result = await executor.executeSwap(
        mockQuote,
        'token-in',
        'token-out',
        1000,
        0.01
      );

      expect(result).toHaveProperty('txHash');
      expect(result).toHaveProperty('executedPrice');
      expect(result).toHaveProperty('inputAmount');
      expect(result).toHaveProperty('outputAmount');
      expect(result).toHaveProperty('fee');
      expect(result).toHaveProperty('timestamp');
    });

    it('should handle zero estimated output gracefully', async () => {
      const zeroOutputQuote: DexQuote = {
        ...mockQuote,
        estimatedOutput: 0
      };

      vi.mocked(mockRaydiumClient.executeSwap).mockResolvedValue(mockSwapResult);

      await executor.executeSwap(
        zeroOutputQuote,
        'token-in',
        'token-out',
        1000,
        0.01
      );

      expect(mockRaydiumClient.executeSwap).toHaveBeenCalledWith(
        expect.objectContaining({
          minAmountOut: 0 // 0 * (1 - 0.01) = 0
        })
      );
    });

    it('should include poolId in swap parameters when provided', async () => {
      vi.mocked(mockRaydiumClient.executeSwap).mockResolvedValue(mockSwapResult);

      await executor.executeSwap(
        mockQuote,
        'token-in',
        'token-out',
        1000,
        0.01
      );

      expect(mockRaydiumClient.executeSwap).toHaveBeenCalledWith(
        expect.objectContaining({
          poolId: 'test-pool'
        })
      );
    });

    it('should handle missing poolId in quote', async () => {
      const quoteWithoutPool: DexQuote = {
        ...mockQuote,
        poolId: undefined
      };

      vi.mocked(mockRaydiumClient.executeSwap).mockResolvedValue(mockSwapResult);

      await executor.executeSwap(
        quoteWithoutPool,
        'token-in',
        'token-out',
        1000,
        0.01
      );

      expect(mockRaydiumClient.executeSwap).toHaveBeenCalledWith(
        expect.objectContaining({
          poolId: undefined
        })
      );
    });
  });

  describe('slippage protection', () => {
    it('should enforce minimum output amount', async () => {
      const quote: DexQuote = {
        dex: 'raydium',
        price: 1.0,
        fee: 0.0025,
        effectivePrice: 0.9975,
        estimatedOutput: 1000
      };

      // Mock will be called with minAmountOut = 990 (1% slippage)
      vi.mocked(mockRaydiumClient.executeSwap).mockImplementation(async (params: SwapParams) => {
        expect(params.minAmountOut).toBe(990);
        return {
          txHash: 'test-hash',
          executedPrice: 0.998,
          inputAmount: 1000,
          outputAmount: 998,
          fee: 2.5,
          timestamp: Date.now()
        };
      });

      await executor.executeSwap(quote, 'token-in', 'token-out', 1000, 0.01);

      expect(mockRaydiumClient.executeSwap).toHaveBeenCalled();
    });

    it('should calculate correct minAmountOut for large amounts', async () => {
      const quote: DexQuote = {
        dex: 'raydium',
        price: 1.0,
        fee: 0.0025,
        effectivePrice: 0.9975,
        estimatedOutput: 1000000000 // 1 billion
      };

      vi.mocked(mockRaydiumClient.executeSwap).mockResolvedValue({
        txHash: 'test-hash',
        executedPrice: 0.998,
        inputAmount: 1000000000,
        outputAmount: 998000000,
        fee: 2500000,
        timestamp: Date.now()
      });

      await executor.executeSwap(quote, 'token-in', 'token-out', 1000000000, 0.01);

      expect(mockRaydiumClient.executeSwap).toHaveBeenCalledWith(
        expect.objectContaining({
          minAmountOut: 990000000 // 1B * 0.99
        })
      );
    });
  });

  describe('configuration', () => {
    it('should use custom default slippage', async () => {
      const customExecutor = new OrderExecutor(mockRaydiumClient, mockMeteoraClient, {
        defaultSlippage: 0.02, // 2%
        maxSlippage: 0.1
      });

      const quote: DexQuote = {
        dex: 'raydium',
        price: 1.0,
        fee: 0.0025,
        effectivePrice: 0.9975,
        estimatedOutput: 1000
      };

      vi.mocked(mockRaydiumClient.executeSwap).mockResolvedValue({
        txHash: 'test-hash',
        executedPrice: 0.998,
        inputAmount: 1000,
        outputAmount: 980,
        fee: 2.5,
        timestamp: Date.now()
      });

      await customExecutor.executeSwap(quote, 'token-in', 'token-out', 1000);

      expect(mockRaydiumClient.executeSwap).toHaveBeenCalledWith(
        expect.objectContaining({
          minAmountOut: 980 // 1000 * (1 - 0.02) = 980
        })
      );
    });

    it('should use custom max slippage', async () => {
      const customExecutor = new OrderExecutor(mockRaydiumClient, mockMeteoraClient, {
        defaultSlippage: 0.01,
        maxSlippage: 0.05 // 5% max
      });

      const quote: DexQuote = {
        dex: 'raydium',
        price: 1.0,
        fee: 0.0025,
        effectivePrice: 0.9975,
        estimatedOutput: 1000
      };

      await expect(
        customExecutor.executeSwap(quote, 'token-in', 'token-out', 1000, 0.06)
      ).rejects.toThrow('Slippage 0.06 is outside acceptable range');
    });
  });
});
