import { getRedisClient } from './redis.js';
import type { OrderRecord } from '../types/index.js';
import { loadConfig } from '../config/env.js';

/**
 * Redis-based cache for active order state
 */
export class OrderCache {
  private readonly keyPrefix = 'order:';

  /**
   * Get cache key for an order
   */
  private getKey(orderId: string): string {
    return `${this.keyPrefix}${orderId}`;
  }

  /**
   * Set order in cache with optional TTL
   */
  async set(orderId: string, order: OrderRecord, ttl?: number): Promise<void> {
    const redis = getRedisClient();
    const config = loadConfig();
    const key = this.getKey(orderId);
    
    // Serialize order to JSON
    const orderData = JSON.stringify({
      orderId: order.orderId,
      tokenIn: order.tokenIn,
      tokenOut: order.tokenOut,
      amount: order.amount,
      slippage: order.slippage,
      status: order.status,
      selectedDex: order.selectedDex,
      txHash: order.txHash,
      executedPrice: order.executedPrice,
      inputAmount: order.inputAmount,
      outputAmount: order.outputAmount,
      failureReason: order.failureReason,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      confirmedAt: order.confirmedAt?.toISOString(),
    });

    const ttlSeconds = ttl || config.REDIS_TTL;
    
    // Set with TTL
    await redis.setex(key, ttlSeconds, orderData);
  }

  /**
   * Get order from cache
   */
  async get(orderId: string): Promise<OrderRecord | null> {
    const redis = getRedisClient();
    const key = this.getKey(orderId);
    
    const data = await redis.get(key);
    
    if (!data) {
      return null;
    }

    try {
      const parsed = JSON.parse(data);
      
      // Convert ISO strings back to Date objects
      return {
        ...parsed,
        createdAt: new Date(parsed.createdAt),
        updatedAt: new Date(parsed.updatedAt),
        confirmedAt: parsed.confirmedAt ? new Date(parsed.confirmedAt) : undefined,
      };
    } catch (error) {
      console.error('Error parsing cached order:', error);
      return null;
    }
  }

  /**
   * Delete order from cache
   */
  async delete(orderId: string): Promise<void> {
    const redis = getRedisClient();
    const key = this.getKey(orderId);
    
    await redis.del(key);
  }

  /**
   * Check if order exists in cache
   */
  async exists(orderId: string): Promise<boolean> {
    const redis = getRedisClient();
    const key = this.getKey(orderId);
    
    const result = await redis.exists(key);
    return result === 1;
  }

  /**
   * Update TTL for an order
   */
  async updateTTL(orderId: string, ttl: number): Promise<void> {
    const redis = getRedisClient();
    const key = this.getKey(orderId);
    
    await redis.expire(key, ttl);
  }

  /**
   * Get all cached order IDs (for debugging/monitoring)
   */
  async getAllOrderIds(): Promise<string[]> {
    const redis = getRedisClient();
    const pattern = `${this.keyPrefix}*`;
    
    const keys = await redis.keys(pattern);
    
    // Extract order IDs from keys
    return keys.map(key => key.replace(this.keyPrefix, ''));
  }

  /**
   * Clear all cached orders (use with caution)
   */
  async clearAll(): Promise<void> {
    const redis = getRedisClient();
    const pattern = `${this.keyPrefix}*`;
    
    const keys = await redis.keys(pattern);
    
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }
}
