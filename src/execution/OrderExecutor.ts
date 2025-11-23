import { DexClient } from '../routing/DexClient';
import { SwapParams, SwapResult, DexQuote } from '../types';
import { logger } from '../utils/logger';

/**
 * Configuration for OrderExecutor
 */
export interface OrderExecutorConfig {
  defaultSlippage?: number; // Default slippage tolerance (e.g., 0.01 for 1%)
  maxSlippage?: number;     // Maximum allowed slippage (e.g., 0.1 for 10%)
}

/**
 * OrderExecutor handles the execution of swaps on selected DEXs
 * with slippage protection and execution price reporting
 * 
 * Requirements: 5.1, 5.2, 5.3, 5.4
 */
export class OrderExecutor {
  private readonly raydiumClient: DexClient;
  private readonly meteoraClient: DexClient;
  private readonly defaultSlippage: number;
  private readonly maxSlippage: number;

  constructor(
    raydiumClient: DexClient,
    meteoraClient: DexClient,
    config: OrderExecutorConfig = {}
  ) {
    this.raydiumClient = raydiumClient;
    this.meteoraClient = meteoraClient;
    this.defaultSlippage = config.defaultSlippage || 0.01; // 1% default
    this.maxSlippage = config.maxSlippage || 0.1; // 10% max
  }

  /**
   * Execute a swap on the selected DEX with slippage protection
   * 
   * Requirement 5.1: Include slippage protection parameters
   * Requirement 5.2: Enforce slippage tolerance
   * Requirement 5.3: Report final execution price
   * Requirement 5.4: Emit failed status with slippage error details
   * 
   * @param quote - The selected DEX quote
   * @param tokenIn - Input token mint address
   * @param tokenOut - Output token mint address
   * @param amount - Amount of input token in base units
   * @param slippage - Slippage tolerance (optional, uses default if not provided)
   * @returns SwapResult with transaction hash and execution details
   */
  async executeSwap(
    quote: DexQuote,
    tokenIn: string,
    tokenOut: string,
    amount: number,
    slippage?: number
  ): Promise<SwapResult> {
    // Use provided slippage or default
    const effectiveSlippage = slippage !== undefined ? slippage : this.defaultSlippage;

    // Validate slippage is within acceptable range
    if (effectiveSlippage < 0 || effectiveSlippage > this.maxSlippage) {
      throw new Error(
        `Slippage ${effectiveSlippage} is outside acceptable range [0, ${this.maxSlippage}]`
      );
    }

    // Requirement 5.1: Calculate minAmountOut based on slippage protection
    const minAmountOut = this.calculateMinAmountOut(quote.estimatedOutput, effectiveSlippage);

    logger.info({
      dex: quote.dex,
      tokenIn,
      tokenOut,
      amount,
      estimatedOutput: quote.estimatedOutput,
      minAmountOut,
      slippage: effectiveSlippage,
      effectivePrice: quote.effectivePrice
    }, 'Executing swap with slippage protection');

    // Build swap parameters
    const swapParams: SwapParams = {
      dex: quote.dex,
      tokenIn,
      tokenOut,
      amount,
      minAmountOut,
      poolId: quote.poolId
    };

    try {
      // Select the appropriate DEX client and execute the swap
      const client = this.selectDexClient(quote.dex);
      const result = await client.executeSwap(swapParams);

      // Requirement 5.3: Report final execution price
      logger.info({
        txHash: result.txHash,
        executedPrice: result.executedPrice,
        inputAmount: result.inputAmount,
        outputAmount: result.outputAmount,
        fee: result.fee,
        estimatedOutput: quote.estimatedOutput,
        actualSlippage: this.calculateActualSlippage(quote.estimatedOutput, result.outputAmount)
      }, 'Swap executed successfully');

      return result;
    } catch (error) {
      // Requirement 5.4: Handle slippage protection failures
      if (error instanceof Error && error.message.includes('Slippage tolerance exceeded')) {
        logger.error({
          error: error.message,
          dex: quote.dex,
          estimatedOutput: quote.estimatedOutput,
          minAmountOut,
          slippage: effectiveSlippage
        }, 'Swap failed due to slippage tolerance');
        
        // Re-throw with enhanced error information
        throw new Error(
          `Slippage tolerance exceeded on ${quote.dex}: ${error.message}`
        );
      }

      // Re-throw other errors
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        dex: quote.dex,
        tokenIn,
        tokenOut,
        amount
      }, 'Swap execution failed');
      
      throw error;
    }
  }

  /**
   * Calculate minimum acceptable output amount based on slippage tolerance
   * Requirement 5.1: minAmountOut = expectedOutput * (1 - slippage)
   * 
   * @param estimatedOutput - Expected output amount from quote
   * @param slippage - Slippage tolerance (e.g., 0.01 for 1%)
   * @returns Minimum acceptable output amount
   */
  private calculateMinAmountOut(estimatedOutput: number, slippage: number): number {
    const minAmount = estimatedOutput * (1 - slippage);
    return Math.floor(minAmount); // Floor to ensure we don't accept fractional tokens
  }

  /**
   * Calculate actual slippage that occurred during execution
   * 
   * @param estimatedOutput - Expected output from quote
   * @param actualOutput - Actual output from execution
   * @returns Actual slippage as a decimal (e.g., 0.005 for 0.5%)
   */
  private calculateActualSlippage(estimatedOutput: number, actualOutput: number): number {
    if (estimatedOutput === 0) return 0;
    return (estimatedOutput - actualOutput) / estimatedOutput;
  }

  /**
   * Select the appropriate DEX client based on the DEX type
   * 
   * @param dex - DEX type ('raydium' or 'meteora')
   * @returns The corresponding DEX client
   */
  private selectDexClient(dex: 'raydium' | 'meteora'): DexClient {
    switch (dex) {
      case 'raydium':
        return this.raydiumClient;
      case 'meteora':
        return this.meteoraClient;
      default:
        throw new Error(`Unknown DEX type: ${dex}`);
    }
  }
}
