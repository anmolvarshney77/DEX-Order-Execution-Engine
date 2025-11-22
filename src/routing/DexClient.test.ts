import { describe, it, expect } from 'vitest';
import { MockRaydiumClient } from './MockRaydiumClient';
import { MockMeteoraClient } from './MockMeteoraClient';
import { generateMockTxHash, isValidTxHash } from './utils';
import { SwapParams } from '../types';

describe('DexClient Mock Implementations', () => {
  describe('MockRaydiumClient', () => {
    const client = new MockRaydiumClient();

    it('should return a valid quote with Raydium-specific properties', async () => {
      const quote = await client.getQuote(
        'So11111111111111111111111111111111111111112', // SOL
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        1000000000 // 1 SOL
      );

      expect(quote.dex).toBe('raydium');
      expect(quote.price).toBeGreaterThan(0);
      expect(quote.fee).toBe(0.0025);
      expect(quote.effectivePrice).toBeLessThan(quote.price);
      expect(quote.poolId).toContain('raydium-pool');
      expect(quote.estimatedOutput).toBeGreaterThan(0);
    });

    it('should execute a swap and return valid result', async () => {
      const params: SwapParams = {
        dex: 'raydium',
        tokenIn: 'So11111111111111111111111111111111111111112',
        tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1000000000,
        minAmountOut: 850000000, // More lenient to account for price variance
        poolId: 'test-pool'
      };

      const result = await client.executeSwap(params);

      expect(result.txHash).toBeDefined();
      expect(isValidTxHash(result.txHash)).toBe(true);
      expect(result.executedPrice).toBeGreaterThan(0);
      expect(result.inputAmount).toBe(params.amount);
      expect(result.outputAmount).toBeGreaterThanOrEqual(params.minAmountOut);
      expect(result.fee).toBeGreaterThan(0);
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it('should throw error when slippage tolerance is exceeded', async () => {
      const params: SwapParams = {
        dex: 'raydium',
        tokenIn: 'So11111111111111111111111111111111111111112',
        tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1000000000,
        minAmountOut: 10000000000, // Unrealistically high minimum
        poolId: 'test-pool'
      };

      await expect(client.executeSwap(params)).rejects.toThrow('Slippage tolerance exceeded');
    });
  });

  describe('MockMeteoraClient', () => {
    const client = new MockMeteoraClient();

    it('should return a valid quote with Meteora-specific properties', async () => {
      const quote = await client.getQuote(
        'So11111111111111111111111111111111111111112',
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        1000000000
      );

      expect(quote.dex).toBe('meteora');
      expect(quote.price).toBeGreaterThan(0);
      expect(quote.fee).toBe(0.002); // Lower fee than Raydium
      expect(quote.effectivePrice).toBeLessThan(quote.price);
      expect(quote.poolId).toContain('meteora-pool');
      expect(quote.estimatedOutput).toBeGreaterThan(0);
    });

    it('should execute a swap and return valid result', async () => {
      const params: SwapParams = {
        dex: 'meteora',
        tokenIn: 'So11111111111111111111111111111111111111112',
        tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1000000000,
        minAmountOut: 850000000, // More lenient to account for price variance
        poolId: 'test-pool'
      };

      const result = await client.executeSwap(params);

      expect(result.txHash).toBeDefined();
      expect(isValidTxHash(result.txHash)).toBe(true);
      expect(result.executedPrice).toBeGreaterThan(0);
      expect(result.inputAmount).toBe(params.amount);
      expect(result.outputAmount).toBeGreaterThanOrEqual(params.minAmountOut);
      expect(result.fee).toBeGreaterThan(0);
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it('should throw error when slippage tolerance is exceeded', async () => {
      const params: SwapParams = {
        dex: 'meteora',
        tokenIn: 'So11111111111111111111111111111111111111112',
        tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1000000000,
        minAmountOut: 10000000000,
        poolId: 'test-pool'
      };

      await expect(client.executeSwap(params)).rejects.toThrow('Slippage tolerance exceeded');
    });
  });

  describe('generateMockTxHash', () => {
    it('should generate valid transaction hashes', () => {
      const raydiumTxHash = generateMockTxHash('raydium');
      const meteoraTxHash = generateMockTxHash('meteora');

      expect(raydiumTxHash).toHaveLength(88);
      expect(meteoraTxHash).toHaveLength(88);
      expect(isValidTxHash(raydiumTxHash)).toBe(true);
      expect(isValidTxHash(meteoraTxHash)).toBe(true);
    });

    it('should generate unique transaction hashes', () => {
      const txHashes = new Set<string>();
      for (let i = 0; i < 100; i++) {
        txHashes.add(generateMockTxHash('raydium'));
      }
      expect(txHashes.size).toBe(100);
    });
  });

  describe('isValidTxHash', () => {
    it('should validate correct transaction hashes', () => {
      const validHash = generateMockTxHash('raydium');
      expect(isValidTxHash(validHash)).toBe(true);
    });

    it('should reject invalid transaction hashes', () => {
      expect(isValidTxHash('too-short')).toBe(false);
      expect(isValidTxHash('a'.repeat(88))).toBe(true); // Valid length and chars
      expect(isValidTxHash('0'.repeat(88))).toBe(false); // Contains invalid char '0'
      expect(isValidTxHash('O'.repeat(88))).toBe(false); // Contains invalid char 'O'
    });
  });
});
