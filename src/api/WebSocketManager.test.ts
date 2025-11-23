import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebSocketManager } from './WebSocketManager.js';
import { OrderStatus } from '../types/index.js';

// WebSocket ready state constants
const WS_OPEN = 1;
const WS_CLOSED = 3;

// Mock WebSocket class
class MockWebSocket {
  readyState: number = WS_OPEN;
  private eventHandlers: Map<string, Function[]> = new Map();

  send = vi.fn();
  close = vi.fn();

  on(event: string, handler: Function) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  emit(event: string, ...args: any[]) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(...args));
    }
  }

  // Simulate connection states
  simulateClose() {
    this.readyState = WS_CLOSED;
    this.emit('close');
  }

  simulateError(error: Error) {
    this.emit('error', error);
  }
}

describe('WebSocketManager', () => {
  let manager: WebSocketManager;

  beforeEach(() => {
    manager = new WebSocketManager();
  });

  describe('addConnection', () => {
    it('should add a WebSocket connection for an order', () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      const orderId = 'order-123';

      manager.addConnection(orderId, ws);

      expect(manager.getConnectionCount(orderId)).toBe(1);
    });

    it('should support multiple connections for the same order', () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;
      const orderId = 'order-123';

      manager.addConnection(orderId, ws1);
      manager.addConnection(orderId, ws2);

      expect(manager.getConnectionCount(orderId)).toBe(2);
    });

    it('should set up error handler that removes connection', () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      const orderId = 'order-123';

      manager.addConnection(orderId, ws);
      expect(manager.getConnectionCount(orderId)).toBe(1);

      // Simulate error
      (ws as any).simulateError(new Error('Connection error'));

      expect(manager.getConnectionCount(orderId)).toBe(0);
    });

    it('should set up close handler that removes connection', () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      const orderId = 'order-123';

      manager.addConnection(orderId, ws);
      expect(manager.getConnectionCount(orderId)).toBe(1);

      // Simulate close
      (ws as any).simulateClose();

      expect(manager.getConnectionCount(orderId)).toBe(0);
    });
  });

  describe('removeConnection', () => {
    it('should remove a specific WebSocket connection', () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;
      const orderId = 'order-123';

      manager.addConnection(orderId, ws1);
      manager.addConnection(orderId, ws2);
      expect(manager.getConnectionCount(orderId)).toBe(2);

      manager.removeConnection(orderId, ws1);

      expect(manager.getConnectionCount(orderId)).toBe(1);
    });

    it('should close the WebSocket if still open', () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      const orderId = 'order-123';

      manager.addConnection(orderId, ws);
      manager.removeConnection(orderId, ws);

      expect(ws.close).toHaveBeenCalled();
    });

    it('should handle removing non-existent connection gracefully', () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      const orderId = 'order-123';

      // Should not throw
      expect(() => manager.removeConnection(orderId, ws)).not.toThrow();
    });

    it('should clean up orderId entry when last connection is removed', () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      const orderId = 'order-123';

      manager.addConnection(orderId, ws);
      expect(manager.getConnectionCount(orderId)).toBe(1);

      manager.removeConnection(orderId, ws);

      expect(manager.getConnectionCount(orderId)).toBe(0);
    });
  });

  describe('emitStatusUpdate', () => {
    it('should send status update to all connected clients', () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;
      const orderId = 'order-123';
      const status: OrderStatus = 'routing';

      manager.addConnection(orderId, ws1);
      manager.addConnection(orderId, ws2);

      manager.emitStatusUpdate(orderId, status);

      expect(ws1.send).toHaveBeenCalledTimes(1);
      expect(ws2.send).toHaveBeenCalledTimes(1);

      const sentMessage = JSON.parse((ws1.send as any).mock.calls[0][0]);
      expect(sentMessage.orderId).toBe(orderId);
      expect(sentMessage.status).toBe(status);
      expect(sentMessage.timestamp).toBeDefined();
    });

    it('should include optional data in status update', () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      const orderId = 'order-123';
      const status: OrderStatus = 'confirmed';
      const data = {
        txHash: 'tx-hash-123',
        executedPrice: 1.5
      };

      manager.addConnection(orderId, ws);
      manager.emitStatusUpdate(orderId, status, data);

      const sentMessage = JSON.parse((ws.send as any).mock.calls[0][0]);
      expect(sentMessage.data).toEqual(data);
    });

    it('should handle no connections gracefully', () => {
      const orderId = 'order-123';
      const status: OrderStatus = 'pending';

      // Should not throw
      expect(() => manager.emitStatusUpdate(orderId, status)).not.toThrow();
    });

    it('should remove disconnected sockets during emission', () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;
      const orderId = 'order-123';

      manager.addConnection(orderId, ws1);
      manager.addConnection(orderId, ws2);

      // Close ws1
      ws1.readyState = WS_CLOSED;

      manager.emitStatusUpdate(orderId, 'routing');

      // ws1 should be removed, ws2 should still be there
      expect(manager.getConnectionCount(orderId)).toBe(1);
      expect(ws2.send).toHaveBeenCalled();
    });

    it('should handle send errors and remove failing connections', () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;
      const orderId = 'order-123';

      manager.addConnection(orderId, ws1);
      manager.addConnection(orderId, ws2);

      // Make ws1.send throw an error
      ws1.send = vi.fn().mockImplementation(() => {
        throw new Error('Send failed');
      });

      manager.emitStatusUpdate(orderId, 'routing');

      // ws1 should be removed due to error
      expect(manager.getConnectionCount(orderId)).toBe(1);
    });

    it('should emit all order status types correctly', () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      const orderId = 'order-123';
      const statuses: OrderStatus[] = ['pending', 'routing', 'building', 'submitted', 'confirmed', 'failed'];

      manager.addConnection(orderId, ws);

      for (const status of statuses) {
        manager.emitStatusUpdate(orderId, status);
        const sentMessage = JSON.parse((ws.send as any).mock.calls[(ws.send as any).mock.calls.length - 1][0]);
        expect(sentMessage.status).toBe(status);
      }

      expect(ws.send).toHaveBeenCalledTimes(statuses.length);
    });
  });

  describe('removeAllConnections', () => {
    it('should remove and close all connections for an order', () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;
      const orderId = 'order-123';

      manager.addConnection(orderId, ws1);
      manager.addConnection(orderId, ws2);

      manager.removeAllConnections(orderId);

      expect(manager.getConnectionCount(orderId)).toBe(0);
      expect(ws1.close).toHaveBeenCalled();
      expect(ws2.close).toHaveBeenCalled();
    });

    it('should handle removing connections for non-existent order', () => {
      const orderId = 'order-123';

      // Should not throw
      expect(() => manager.removeAllConnections(orderId)).not.toThrow();
    });
  });

  describe('getConnectionCount', () => {
    it('should return 0 for non-existent order', () => {
      expect(manager.getConnectionCount('non-existent')).toBe(0);
    });

    it('should return correct count for order with connections', () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;
      const orderId = 'order-123';

      manager.addConnection(orderId, ws1);
      expect(manager.getConnectionCount(orderId)).toBe(1);

      manager.addConnection(orderId, ws2);
      expect(manager.getConnectionCount(orderId)).toBe(2);
    });
  });

  describe('getTotalConnectionCount', () => {
    it('should return 0 when no connections exist', () => {
      expect(manager.getTotalConnectionCount()).toBe(0);
    });

    it('should return total count across all orders', () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;
      const ws3 = new MockWebSocket() as unknown as WebSocket;

      manager.addConnection('order-1', ws1);
      manager.addConnection('order-1', ws2);
      manager.addConnection('order-2', ws3);

      expect(manager.getTotalConnectionCount()).toBe(3);
    });
  });

  describe('closeAll', () => {
    it('should close all connections across all orders', () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;
      const ws3 = new MockWebSocket() as unknown as WebSocket;

      manager.addConnection('order-1', ws1);
      manager.addConnection('order-1', ws2);
      manager.addConnection('order-2', ws3);

      manager.closeAll();

      expect(ws1.close).toHaveBeenCalled();
      expect(ws2.close).toHaveBeenCalled();
      expect(ws3.close).toHaveBeenCalled();
      expect(manager.getTotalConnectionCount()).toBe(0);
    });

    it('should handle errors during closeAll gracefully', () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      ws.close = vi.fn().mockImplementation(() => {
        throw new Error('Close failed');
      });

      manager.addConnection('order-1', ws);

      // Should not throw
      expect(() => manager.closeAll()).not.toThrow();
    });
  });

  describe('connection lifecycle', () => {
    it('should handle complete order lifecycle with status updates', () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      const orderId = 'order-123';

      // Add connection
      manager.addConnection(orderId, ws);
      expect(manager.getConnectionCount(orderId)).toBe(1);

      // Emit various status updates
      manager.emitStatusUpdate(orderId, 'pending');
      manager.emitStatusUpdate(orderId, 'routing');
      manager.emitStatusUpdate(orderId, 'building');
      manager.emitStatusUpdate(orderId, 'submitted');
      manager.emitStatusUpdate(orderId, 'confirmed', { txHash: 'tx-123' });

      expect(ws.send).toHaveBeenCalledTimes(5);

      // Clean up
      manager.removeAllConnections(orderId);
      expect(manager.getConnectionCount(orderId)).toBe(0);
    });

    it('should handle multiple orders with independent connections', () => {
      const ws1 = new MockWebSocket() as unknown as WebSocket;
      const ws2 = new MockWebSocket() as unknown as WebSocket;

      manager.addConnection('order-1', ws1);
      manager.addConnection('order-2', ws2);

      manager.emitStatusUpdate('order-1', 'routing');
      manager.emitStatusUpdate('order-2', 'building');

      // Each should only receive their own updates
      expect(ws1.send).toHaveBeenCalledTimes(1);
      expect(ws2.send).toHaveBeenCalledTimes(1);

      const msg1 = JSON.parse((ws1.send as any).mock.calls[0][0]);
      const msg2 = JSON.parse((ws2.send as any).mock.calls[0][0]);

      expect(msg1.orderId).toBe('order-1');
      expect(msg2.orderId).toBe('order-2');
    });
  });
});
