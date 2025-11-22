import { DexClient } from './DexClient';
import { DexQuote, SwapParams, SwapResult } from '../types';
import { generateMockTxHash } from './utils';

/**
 * Mock implementation of Meteora DEX client
 * Simulates realistic delays and price variance for testing
 */
export class MockMeteoraClient implements DexClient {
  private readonly baseDelay: number = 200; // Base delay for quote requests in ms
  private readonly executionDelay: number = 2500; // Execution delay in ms
  private readonly fee: number = 0.002; // 0.2% fee (slightly lower than Raydium)

  /**
   * Get a simulated price quote from Meteora
   * Simulates 200ms network delay and adds realistic price variance
   */
  async getQuote(tokenIn: string, tokenOut: string, amount: number): Promise<DexQuote> {
    // Simulate network delay
    await this.delay(this.baseDelay);

    // Generate a base price with some randomness (0.95 to 1.05 range)
    // Meteora might have slightly different prices than Raydium
    const basePrice = 1.0 + (Math.random() * 0.1 - 0.05);
    
    // Calculate estimated output
    const estimatedOutput = amount * basePrice;
    
    // Calculate effective price after fees
    const effectivePrice = basePrice * (1 - this.fee);

    return {
      dex: 'meteora',
      price: basePrice,
      fee: this.fee,
      effectivePrice,
      poolId: `meteora-pool-${tokenIn.slice(0, 8)}-${tokenOut.slice(0, 8)}`,
      estimatedOutput
    };
  }

  /**
   * Execute a simulated swap on Meteora
   * Simulates 2-3 second execution time with realistic price slippage
   */
  async executeSwap(params: SwapParams): Promise<SwapResult> {
    // Simulate execution delay (2.5s base + up to 500ms variance)
    const executionTime = this.executionDelay + Math.random() * 500;
    await this.delay(executionTime);

    // Generate a realistic price (similar to getQuote but with execution variance)
    // Price represents output tokens per input token
    const basePrice = 1.0 + (Math.random() * 0.1 - 0.05); // 0.95 to 1.05
    
    // Add execution slippage (±0.5%)
    const executionSlippage = 1.0 + (Math.random() * 0.01 - 0.005);
    const executedPrice = basePrice * executionSlippage;
    
    // Calculate actual output amount
    const outputAmount = Math.floor(params.amount * executedPrice);
    
    // Verify slippage protection
    if (outputAmount < params.minAmountOut) {
      throw new Error(
        `Slippage tolerance exceeded: expected at least ${params.minAmountOut}, got ${outputAmount}`
      );
    }

    // Calculate fee amount
    const feeAmount = params.amount * this.fee;

    return {
      txHash: generateMockTxHash('meteora'),
      executedPrice,
      inputAmount: params.amount,
      outputAmount,
      fee: feeAmount,
      timestamp: Date.now()
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
