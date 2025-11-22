import { DexQuote, SwapParams, SwapResult } from '../types';

/**
 * Interface for DEX client implementations
 * Supports both real DEX SDK integrations and mock implementations
 */
export interface DexClient {
  /**
   * Get a price quote for a token swap
   * @param tokenIn - Input token mint address
   * @param tokenOut - Output token mint address
   * @param amount - Amount of input token in base units
   * @returns Promise resolving to a DexQuote with price and fee information
   */
  getQuote(tokenIn: string, tokenOut: string, amount: number): Promise<DexQuote>;

  /**
   * Execute a token swap on the DEX
   * @param params - Swap parameters including tokens, amounts, and slippage protection
   * @returns Promise resolving to SwapResult with transaction hash and execution details
   */
  executeSwap(params: SwapParams): Promise<SwapResult>;
}
