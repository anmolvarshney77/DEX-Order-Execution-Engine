import { DexClient } from './DexClient';
import { DexQuote } from '../types';
import { logger } from '../utils/logger';

/**
 * Configuration for DexRouter
 */
export interface DexRouterConfig {
  quoteTimeout?: number; // Timeout for quote requests in milliseconds
}

/**
 * DEX Router handles price comparison across multiple DEXs
 * and selects the optimal execution venue
 * 
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5
 */
export class DexRouter {
  private readonly raydiumClient: DexClient;
  private readonly meteoraClient: DexClient;
  private readonly quoteTimeout: number;

  // Wrapped SOL token mint address on Solana
  private readonly WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';
  // Native SOL identifier
  private readonly NATIVE_SOL = 'SOL';

  constructor(
    raydiumClient: DexClient,
    meteoraClient: DexClient,
    config: DexRouterConfig = {}
  ) {
    this.raydiumClient = raydiumClient;
    this.meteoraClient = meteoraClient;
    this.quoteTimeout = config.quoteTimeout || 5000;
  }

  /**
   * Get price quotes from both Raydium and Meteora DEXs in parallel
   * Requirement 2.1: Query both DEXs for price quotes
   * 
   * @param tokenIn - Input token mint address
   * @param tokenOut - Output token mint address
   * @param amount - Amount of input token in base units
   * @returns Array of quotes from both DEXs
   */
  async getQuotes(tokenIn: string, tokenOut: string, amount: number): Promise<DexQuote[]> {
    // Handle wrapped SOL conversion before querying
    const actualTokenIn = this.handleWrappedSol(tokenIn);
    const actualTokenOut = this.handleWrappedSol(tokenOut);

    logger.info({
      tokenIn: actualTokenIn,
      tokenOut: actualTokenOut,
      amount,
      originalTokenIn: tokenIn,
      originalTokenOut: tokenOut
    }, 'Fetching quotes from both DEXs');

    // Query both DEXs in parallel with timeout protection
    const quotePromises = [
      this.getQuoteWithTimeout(this.raydiumClient, actualTokenIn, actualTokenOut, amount, 'raydium'),
      this.getQuoteWithTimeout(this.meteoraClient, actualTokenIn, actualTokenOut, amount, 'meteora')
    ];

    const results = await Promise.allSettled(quotePromises);

    // Extract successful quotes
    const quotes: DexQuote[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        quotes.push(result.value);
      } else {
        logger.warn({ error: result.reason }, 'Failed to get quote from DEX');
      }
    }

    if (quotes.length === 0) {
      throw new Error('Failed to get quotes from any DEX');
    }

    logger.info({
      quotesReceived: quotes.length,
      quotes: quotes.map(q => ({
        dex: q.dex,
        price: q.price,
        fee: q.fee,
        effectivePrice: q.effectivePrice
      }))
    }, 'Received quotes from DEXs');

    return quotes;
  }

  /**
   * Select the DEX offering the best effective price
   * Requirement 2.2: Compare effective prices including fees
   * Requirement 2.3: Select DEX with better net price
   * 
   * @param quotes - Array of quotes from different DEXs
   * @returns The quote with the best effective price
   */
  selectBestDex(quotes: DexQuote[]): DexQuote {
    if (quotes.length === 0) {
      throw new Error('No quotes available for comparison');
    }

    // Find the quote with the highest effective price
    // Higher effective price means more output tokens for the user
    const bestQuote = quotes.reduce((best, current) => {
      return current.effectivePrice > best.effectivePrice ? current : best;
    });

    // Requirement 2.4: Log routing decision with price details
    this.logRoutingDecision(quotes, bestQuote);

    return bestQuote;
  }

  /**
   * Handle wrapped SOL conversion
   * Requirement 2.5: Automatically handle wrapped SOL conversion
   * 
   * @param tokenMint - Token mint address or 'SOL'
   * @returns Wrapped SOL mint if native SOL, otherwise original mint
   */
  handleWrappedSol(tokenMint: string): string {
    if (tokenMint === this.NATIVE_SOL || tokenMint.toUpperCase() === this.NATIVE_SOL) {
      logger.debug({ originalToken: tokenMint, wrappedToken: this.WRAPPED_SOL_MINT }, 'Converting native SOL to wrapped SOL');
      return this.WRAPPED_SOL_MINT;
    }
    return tokenMint;
  }

  /**
   * Log routing decision with details from all DEXs
   * Requirement 2.4: Log routing decision with price details from both venues
   * 
   * @param allQuotes - All quotes received
   * @param selectedQuote - The selected best quote
   */
  private logRoutingDecision(allQuotes: DexQuote[], selectedQuote: DexQuote): void {
    const raydiumQuote = allQuotes.find(q => q.dex === 'raydium');
    const meteoraQuote = allQuotes.find(q => q.dex === 'meteora');

    logger.info({
      selectedDex: selectedQuote.dex,
      selectedEffectivePrice: selectedQuote.effectivePrice,
      raydium: raydiumQuote ? {
        price: raydiumQuote.price,
        fee: raydiumQuote.fee,
        effectivePrice: raydiumQuote.effectivePrice,
        estimatedOutput: raydiumQuote.estimatedOutput
      } : 'unavailable',
      meteora: meteoraQuote ? {
        price: meteoraQuote.price,
        fee: meteoraQuote.fee,
        effectivePrice: meteoraQuote.effectivePrice,
        estimatedOutput: meteoraQuote.estimatedOutput
      } : 'unavailable',
      priceDifference: raydiumQuote && meteoraQuote 
        ? Math.abs(raydiumQuote.effectivePrice - meteoraQuote.effectivePrice)
        : 'N/A'
    }, 'Routing decision made');
  }

  /**
   * Get a quote with timeout protection
   * 
   * @param client - DEX client to query
   * @param tokenIn - Input token
   * @param tokenOut - Output token
   * @param amount - Input amount
   * @param dexName - Name of the DEX for logging
   * @returns Quote from the DEX
   */
  private async getQuoteWithTimeout(
    client: DexClient,
    tokenIn: string,
    tokenOut: string,
    amount: number,
    dexName: string
  ): Promise<DexQuote> {
    return Promise.race([
      client.getQuote(tokenIn, tokenOut, amount),
      this.createTimeoutPromise(dexName)
    ]);
  }

  /**
   * Create a promise that rejects after the configured timeout
   * 
   * @param dexName - Name of the DEX for error message
   * @returns Promise that rejects on timeout
   */
  private createTimeoutPromise(dexName: string): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Quote request to ${dexName} timed out after ${this.quoteTimeout}ms`));
      }, this.quoteTimeout);
    });
  }
}
