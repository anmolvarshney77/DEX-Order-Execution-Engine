import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { OrderRepository } from './OrderRepository.js';
import { getPool, closePool } from './database.js';
import type { OrderRecord } from '../types/index.js';

describe('OrderRepository', () => {
  let repository: OrderRepository;

  beforeAll(async () => {
    repository = new OrderRepository();
    // Ensure database connection is working
    const pool = getPool();
    await pool.query('SELECT 1');
  });

  afterAll(async () => {
    await closePool();
  });

  beforeEach(async () => {
    // Clean up test data before each test
    const pool = getPool();
    await pool.query('DELETE FROM order_status_history');
    await pool.query('DELETE FROM orders');
  });

  describe('create', () => {
    it('should create a new order record', async () => {
      const orderData: Omit<OrderRecord, 'orderId' | 'createdAt' | 'updatedAt'> = {
        tokenIn: 'So11111111111111111111111111111111111111112',
        tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1000000,
        slippage: 0.01,
        status: 'pending',
      };

      const created = await repository.create(orderData);

      expect(created.orderId).toBeDefined();
      expect(created.tokenIn).toBe(orderData.tokenIn);
      expect(created.tokenOut).toBe(orderData.tokenOut);
      expect(created.amount).toBe(orderData.amount);
      expect(created.slippage).toBe(orderData.slippage);
      expect(created.status).toBe('pending');
      expect(created.createdAt).toBeInstanceOf(Date);
      expect(created.updatedAt).toBeInstanceOf(Date);
    });

    it('should record initial status in history', async () => {
      const orderData: Omit<OrderRecord, 'orderId' | 'createdAt' | 'updatedAt'> = {
        tokenIn: 'So11111111111111111111111111111111111111112',
        tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1000000,
        slippage: 0.01,
        status: 'pending',
      };

      const created = await repository.create(orderData);
      const history = await repository.getStatusHistory(created.orderId);

      expect(history).toHaveLength(1);
      expect(history[0].status).toBe('pending');
      expect(history[0].orderId).toBe(created.orderId);
    });
  });

  describe('updateStatus', () => {
    it('should update order status', async () => {
      const orderData: Omit<OrderRecord, 'orderId' | 'createdAt' | 'updatedAt'> = {
        tokenIn: 'So11111111111111111111111111111111111111112',
        tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1000000,
        slippage: 0.01,
        status: 'pending',
      };

      const created = await repository.create(orderData);
      await repository.updateStatus(created.orderId, 'routing');

      const updated = await repository.findById(created.orderId);
      expect(updated?.status).toBe('routing');
    });

    it('should update order with additional data', async () => {
      const orderData: Omit<OrderRecord, 'orderId' | 'createdAt' | 'updatedAt'> = {
        tokenIn: 'So11111111111111111111111111111111111111112',
        tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1000000,
        slippage: 0.01,
        status: 'pending',
      };

      const created = await repository.create(orderData);
      await repository.updateStatus(created.orderId, 'confirmed', {
        txHash: 'test-tx-hash-123',
        executedPrice: 1.5,
        selectedDex: 'raydium',
        inputAmount: 1000000,
        outputAmount: 1500000,
      });

      const updated = await repository.findById(created.orderId);
      expect(updated?.status).toBe('confirmed');
      expect(updated?.txHash).toBe('test-tx-hash-123');
      expect(updated?.executedPrice).toBe(1.5);
      expect(updated?.selectedDex).toBe('raydium');
      expect(updated?.confirmedAt).toBeInstanceOf(Date);
    });

    it('should record status changes in history', async () => {
      const orderData: Omit<OrderRecord, 'orderId' | 'createdAt' | 'updatedAt'> = {
        tokenIn: 'So11111111111111111111111111111111111111112',
        tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1000000,
        slippage: 0.01,
        status: 'pending',
      };

      const created = await repository.create(orderData);
      await repository.updateStatus(created.orderId, 'routing');
      await repository.updateStatus(created.orderId, 'building');
      await repository.updateStatus(created.orderId, 'confirmed');

      const history = await repository.getStatusHistory(created.orderId);
      expect(history).toHaveLength(4); // pending, routing, building, confirmed
      expect(history.map(h => h.status)).toEqual(['pending', 'routing', 'building', 'confirmed']);
    });
  });

  describe('findById', () => {
    it('should find order by ID', async () => {
      const orderData: Omit<OrderRecord, 'orderId' | 'createdAt' | 'updatedAt'> = {
        tokenIn: 'So11111111111111111111111111111111111111112',
        tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1000000,
        slippage: 0.01,
        status: 'pending',
      };

      const created = await repository.create(orderData);
      const found = await repository.findById(created.orderId);

      expect(found).not.toBeNull();
      expect(found?.orderId).toBe(created.orderId);
      expect(found?.tokenIn).toBe(orderData.tokenIn);
    });

    it('should return null for non-existent order', async () => {
      const found = await repository.findById('00000000-0000-0000-0000-000000000000');
      expect(found).toBeNull();
    });
  });

  describe('findRecent', () => {
    it('should find recent orders', async () => {
      // Create multiple orders
      for (let i = 0; i < 5; i++) {
        await repository.create({
          tokenIn: 'So11111111111111111111111111111111111111112',
          tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          amount: 1000000 + i,
          slippage: 0.01,
          status: 'pending',
        });
      }

      const recent = await repository.findRecent(3);
      expect(recent).toHaveLength(3);
      
      // Should be ordered by created_at DESC
      expect(recent[0].amount).toBeGreaterThan(recent[1].amount);
    });

    it('should respect limit parameter', async () => {
      // Create multiple orders
      for (let i = 0; i < 10; i++) {
        await repository.create({
          tokenIn: 'So11111111111111111111111111111111111111112',
          tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          amount: 1000000,
          slippage: 0.01,
          status: 'pending',
        });
      }

      const recent = await repository.findRecent(5);
      expect(recent).toHaveLength(5);
    });
  });
});
