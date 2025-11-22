import { describe, it, expect } from 'vitest';
import { OrderRepository } from './OrderRepository.js';
import { OrderCache } from './OrderCache.js';

describe('Persistence Layer Integration', () => {
  describe('OrderRepository', () => {
    it('should be instantiable', () => {
      const repository = new OrderRepository();
      expect(repository).toBeDefined();
      expect(repository.create).toBeDefined();
      expect(repository.updateStatus).toBeDefined();
      expect(repository.findById).toBeDefined();
      expect(repository.findRecent).toBeDefined();
      expect(repository.getStatusHistory).toBeDefined();
    });

    it('should have correct method signatures', () => {
      const repository = new OrderRepository();
      expect(typeof repository.create).toBe('function');
      expect(typeof repository.updateStatus).toBe('function');
      expect(typeof repository.findById).toBe('function');
      expect(typeof repository.findRecent).toBe('function');
      expect(typeof repository.getStatusHistory).toBe('function');
    });
  });

  describe('OrderCache', () => {
    it('should be instantiable', () => {
      const cache = new OrderCache();
      expect(cache).toBeDefined();
      expect(cache.set).toBeDefined();
      expect(cache.get).toBeDefined();
      expect(cache.delete).toBeDefined();
      expect(cache.exists).toBeDefined();
      expect(cache.updateTTL).toBeDefined();
      expect(cache.getAllOrderIds).toBeDefined();
      expect(cache.clearAll).toBeDefined();
    });

    it('should have correct method signatures', () => {
      const cache = new OrderCache();
      expect(typeof cache.set).toBe('function');
      expect(typeof cache.get).toBe('function');
      expect(typeof cache.delete).toBe('function');
      expect(typeof cache.exists).toBe('function');
      expect(typeof cache.updateTTL).toBe('function');
      expect(typeof cache.getAllOrderIds).toBe('function');
      expect(typeof cache.clearAll).toBe('function');
    });
  });
});
