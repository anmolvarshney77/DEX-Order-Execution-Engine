import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { OrderCache } from './OrderCache.js';
import { getRedisClient, closeRedis } from './redis.js';
import type { OrderRecord } from '../types/index.js';

describe('OrderCache', () => {
  let cache: OrderCache;

  beforeAll(async () => {
    cache = new OrderCache();
    // Ensure Redis connection is working
    const redis = getRedisClient();
    await redis.ping();
  });

  afterAll(async () => {
    await closeRedis();
  });

  beforeEach(async () => {
    // Clean up test data before each test
    await cache.clearAll();
  });

  describe('set and get', () => {
    it('should set and get an order', async () => {
      const order: OrderRecord = {
        orderId: 'test-order-123',
        tokenIn: 'So11111111111111111111111111111111111111112',
        tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1000000,
        slippage: 0.01,
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await cache.set(order.orderId, order);
      const retrieved = await cache.get(order.orderId);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.orderId).toBe(order.orderId);
      expect(retrieved?.tokenIn).toBe(order.tokenIn);
      expect(retrieved?.status).toBe('pending');
      expect(retrieved?.createdAt).toBeInstanceOf(Date);
    });

    it('should return null for non-existent order', async () => {
      const retrieved = await cache.get('non-existent-order');
      expect(retrieved).toBeNull();
    });

    it('should handle orders with optional fields', async () => {
      const order: OrderRecord = {
        orderId: 'test-order-456',
        tokenIn: 'So11111111111111111111111111111111111111112',
        tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1000000,
        slippage: 0.01,
        status: 'confirmed',
        selectedDex: 'raydium',
        txHash: 'test-tx-hash',
        executedPrice: 1.5,
        inputAmount: 1000000,
        outputAmount: 1500000,
        createdAt: new Date(),
        updatedAt: new Date(),
        confirmedAt: new Date(),
      };

      await cache.set(order.orderId, order);
      const retrieved = await cache.get(order.orderId);

      expect(retrieved?.selectedDex).toBe('raydium');
      expect(retrieved?.txHash).toBe('test-tx-hash');
      expect(retrieved?.executedPrice).toBe(1.5);
      expect(retrieved?.confirmedAt).toBeInstanceOf(Date);
    });
  });

  describe('delete', () => {
    it('should delete an order from cache', async () => {
      const order: OrderRecord = {
        orderId: 'test-order-789',
        tokenIn: 'So11111111111111111111111111111111111111112',
        tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1000000,
        slippage: 0.01,
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await cache.set(order.orderId, order);
      expect(await cache.exists(order.orderId)).toBe(true);

      await cache.delete(order.orderId);
      expect(await cache.exists(order.orderId)).toBe(false);

      const retrieved = await cache.get(order.orderId);
      expect(retrieved).toBeNull();
    });
  });

  describe('exists', () => {
    it('should check if order exists in cache', async () => {
      const order: OrderRecord = {
        orderId: 'test-order-exists',
        tokenIn: 'So11111111111111111111111111111111111111112',
        tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1000000,
        slippage: 0.01,
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(await cache.exists(order.orderId)).toBe(false);
      
      await cache.set(order.orderId, order);
      expect(await cache.exists(order.orderId)).toBe(true);
    });
  });

  describe('TTL management', () => {
    it('should set order with custom TTL', async () => {
      const order: OrderRecord = {
        orderId: 'test-order-ttl',
        tokenIn: 'So11111111111111111111111111111111111111112',
        tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1000000,
        slippage: 0.01,
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Set with 2 second TTL
      await cache.set(order.orderId, order, 2);
      expect(await cache.exists(order.orderId)).toBe(true);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 2100));
      expect(await cache.exists(order.orderId)).toBe(false);
    });

    it('should update TTL for existing order', async () => {
      const order: OrderRecord = {
        orderId: 'test-order-update-ttl',
        tokenIn: 'So11111111111111111111111111111111111111112',
        tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1000000,
        slippage: 0.01,
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await cache.set(order.orderId, order, 1);
      await cache.updateTTL(order.orderId, 10);
      
      // Wait 1.5 seconds - should still exist due to updated TTL
      await new Promise(resolve => setTimeout(resolve, 1500));
      expect(await cache.exists(order.orderId)).toBe(true);
    });
  });

  describe('getAllOrderIds', () => {
    it('should get all cached order IDs', async () => {
      const orders = [
        { orderId: 'order-1', status: 'pending' as const },
        { orderId: 'order-2', status: 'routing' as const },
        { orderId: 'order-3', status: 'confirmed' as const },
      ];

      for (const orderData of orders) {
        const order: OrderRecord = {
          ...orderData,
          tokenIn: 'So11111111111111111111111111111111111111112',
          tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          amount: 1000000,
          slippage: 0.01,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await cache.set(order.orderId, order);
      }

      const orderIds = await cache.getAllOrderIds();
      expect(orderIds).toHaveLength(3);
      expect(orderIds).toContain('order-1');
      expect(orderIds).toContain('order-2');
      expect(orderIds).toContain('order-3');
    });
  });

  describe('clearAll', () => {
    it('should clear all cached orders', async () => {
      // Create multiple orders
      for (let i = 0; i < 5; i++) {
        const order: OrderRecord = {
          orderId: `order-${i}`,
          tokenIn: 'So11111111111111111111111111111111111111112',
          tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          amount: 1000000,
          slippage: 0.01,
          status: 'pending',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await cache.set(order.orderId, order);
      }

      let orderIds = await cache.getAllOrderIds();
      expect(orderIds.length).toBeGreaterThan(0);

      await cache.clearAll();
      
      orderIds = await cache.getAllOrderIds();
      expect(orderIds).toHaveLength(0);
    });
  });
});
