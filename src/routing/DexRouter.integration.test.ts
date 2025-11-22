import { describe, it, expect, beforeEach } from 'vitest';
import { DexRouter } from './DexRouter';
import { MockRaydiumClient } from './MockRaydiumClient';
import { MockMeteoraClient } from './MockMeteoraClient';

describe('DexRouter Integration Tests', () => {
  let router: DexRouter;
  let raydiumClient: MockRaydiumClient;
  let meteoraClient: MockMeteoraClient;

  beforeEach(() => {
    raydiumClient = new MockRaydiumClient();
    meteoraClient = new MockMeteoraClient();
    router = new DexRouter(raydiumClient, meteoraClient);
  });

  it('should get quotes from both mock DEX clients', async () => {
    const tokenIn = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC
    const tokenOut = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'; // USDT
    const amount = 1000000; // 1 USDC (6 decimals)

    const quotes = await router.getQuotes(tokenIn, tokenOut, amount);

    expect(quotes).toHaveLength(2);
    
    const raydiumQuote = quotes.find(q => q.dex === 'raydium');
    const meteoraQuote = quotes.find(q => q.dex === 'meteora');

    expect(raydiumQuote).toBeDefined();
    expect(meteoraQuote).toBeDefined();

    // Verify Raydium quote structure
    expect(raydiumQuote?.dex).toBe('raydium');
    expect(raydiumQuote?.fee).toBe(0.0025);
    expect(raydiumQuote?.price).toBeGreaterThan(0);
    expect(raydiumQuote?.effectivePrice).toBeLessThan(raydiumQuote!.price);
    expect(raydiumQuote?.estimatedOutput).toBeGreaterThan(0);

    // Verify Meteora quote structure
    expect(meteoraQuote?.dex).toBe('meteora');
    expect(meteoraQuote?.fee).toBe(0.002);
    expect(meteoraQuote?.price).toBeGreaterThan(0);
    expect(meteoraQuote?.effectivePrice).toBeLessThan(meteoraQuote!.price);
    expect(meteoraQuote?.estimatedOutput).toBeGreaterThan(0);
  });

  it('should select the best DEX based on effective price', async () => {
    const tokenIn = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const tokenOut = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
    const amount = 1000000;

    const quotes = await router.getQuotes(tokenIn, tokenOut, amount);
    const bestQuote = router.selectBestDex(quotes);

    expect(bestQuote).toBeDefined();
    expect(['raydium', 'meteora']).toContain(bestQuote.dex);

    // Verify the selected quote has the highest effective price
    const maxEffectivePrice = Math.max(...quotes.map(q => q.effectivePrice));
    expect(bestQuote.effectivePrice).toBe(maxEffectivePrice);
  });

  it('should handle native SOL to token swaps', async () => {
    const tokenIn = 'SOL';
    const tokenOut = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC
    const amount = 1000000000; // 1 SOL (9 decimals)

    const quotes = await router.getQuotes(tokenIn, tokenOut, amount);

    expect(quotes).toHaveLength(2);
    expect(quotes[0].estimatedOutput).toBeGreaterThan(0);
    expect(quotes[1].estimatedOutput).toBeGreaterThan(0);
  });

  it('should handle token to native SOL swaps', async () => {
    const tokenIn = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC
    const tokenOut = 'SOL';
    const amount = 1000000; // 1 USDC

    const quotes = await router.getQuotes(tokenIn, tokenOut, amount);

    expect(quotes).toHaveLength(2);
    expect(quotes[0].estimatedOutput).toBeGreaterThan(0);
    expect(quotes[1].estimatedOutput).toBeGreaterThan(0);
  });

  it('should complete full routing flow: get quotes and select best', async () => {
    const tokenIn = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const tokenOut = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
    const amount = 5000000; // 5 USDC

    // Step 1: Get quotes
    const quotes = await router.getQuotes(tokenIn, tokenOut, amount);
    expect(quotes).toHaveLength(2);

    // Step 2: Select best DEX
    const bestQuote = router.selectBestDex(quotes);
    expect(bestQuote).toBeDefined();

    // Step 3: Verify the selection makes sense
    const otherQuote = quotes.find(q => q.dex !== bestQuote.dex);
    if (otherQuote) {
      expect(bestQuote.effectivePrice).toBeGreaterThanOrEqual(otherQuote.effectivePrice);
    }

    // Step 4: Verify we can use the selected quote for execution
    expect(bestQuote.poolId).toBeDefined();
    expect(bestQuote.estimatedOutput).toBeGreaterThan(0);
  });

  it('should handle multiple sequential routing requests', async () => {
    const tokenIn = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const tokenOut = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

    // Make 3 routing requests
    const results = await Promise.all([
      router.getQuotes(tokenIn, tokenOut, 1000000),
      router.getQuotes(tokenIn, tokenOut, 2000000),
      router.getQuotes(tokenIn, tokenOut, 3000000)
    ]);

    // All should succeed
    expect(results).toHaveLength(3);
    results.forEach(quotes => {
      expect(quotes).toHaveLength(2);
    });

    // Verify estimated outputs scale with input amounts
    const quotes1 = results[0];
    const quotes2 = results[1];
    const quotes3 = results[2];

    const raydium1 = quotes1.find(q => q.dex === 'raydium')!;
    const raydium2 = quotes2.find(q => q.dex === 'raydium')!;
    const raydium3 = quotes3.find(q => q.dex === 'raydium')!;

    // Outputs should roughly scale with inputs (allowing for price variance)
    expect(raydium2.estimatedOutput).toBeGreaterThan(raydium1.estimatedOutput);
    expect(raydium3.estimatedOutput).toBeGreaterThan(raydium2.estimatedOutput);
  });

  it('should demonstrate fee impact on effective price', async () => {
    const tokenIn = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const tokenOut = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
    const amount = 1000000;

    const quotes = await router.getQuotes(tokenIn, tokenOut, amount);

    const raydiumQuote = quotes.find(q => q.dex === 'raydium')!;
    const meteoraQuote = quotes.find(q => q.dex === 'meteora')!;

    // Raydium has 0.25% fee, Meteora has 0.2% fee
    expect(raydiumQuote.fee).toBe(0.0025);
    expect(meteoraQuote.fee).toBe(0.002);

    // Effective price should be lower than base price due to fees
    expect(raydiumQuote.effectivePrice).toBeLessThan(raydiumQuote.price);
    expect(meteoraQuote.effectivePrice).toBeLessThan(meteoraQuote.price);

    // Fee impact calculation
    const raydiumFeeImpact = raydiumQuote.price - raydiumQuote.effectivePrice;
    const meteoraFeeImpact = meteoraQuote.price - meteoraQuote.effectivePrice;

    // Raydium should have higher fee impact
    expect(raydiumFeeImpact).toBeGreaterThan(meteoraFeeImpact);
  });
});
