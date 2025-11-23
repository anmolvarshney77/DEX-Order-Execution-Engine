import { WebSocket } from '@fastify/websocket';
import { WebSocketMessage, OrderStatus } from '../types/index.js';
import { logger } from '../utils/logger.js';

// WebSocket ready state constants
const WS_OPEN = 1;

/**
 * WebSocketManager manages WebSocket connections for real-time order status updates.
 * Connections are pooled by orderId to support multiple clients tracking the same order.
 */
export class WebSocketManager {
  // Map of orderId to Set of WebSocket connections
  private connections: Map<string, Set<WebSocket>>;

  constructor() {
    this.connections = new Map();
  }

  /**
   * Register a WebSocket connection for a specific order
   * @param orderId - The order ID to track
   * @param ws - The WebSocket connection
   */
  addConnection(orderId: string, ws: WebSocket): void {
    if (!this.connections.has(orderId)) {
      this.connections.set(orderId, new Set());
    }

    const orderConnections = this.connections.get(orderId)!;
    orderConnections.add(ws);

    logger.info({ orderId, totalConnections: orderConnections.size }, 'WebSocket connection added');

    // Set up error and close handlers
    ws.on('error', (error) => {
      logger.error({ orderId, error: error.message }, 'WebSocket error occurred');
      this.removeConnection(orderId, ws);
    });

    ws.on('close', () => {
      logger.info({ orderId }, 'WebSocket connection closed');
      this.removeConnection(orderId, ws);
    });
  }

  /**
   * Remove a specific WebSocket connection for an order
   * @param orderId - The order ID
   * @param ws - The WebSocket connection to remove
   */
  removeConnection(orderId: string, ws: WebSocket): void {
    const orderConnections = this.connections.get(orderId);
    if (!orderConnections) {
      return;
    }

    orderConnections.delete(ws);

    // Clean up the orderId entry if no connections remain
    if (orderConnections.size === 0) {
      this.connections.delete(orderId);
      logger.info({ orderId }, 'All WebSocket connections removed for order');
    }

    // Safely close the WebSocket if it's still open
    try {
      if (ws.readyState === WS_OPEN) {
        ws.close();
      }
    } catch (error) {
      logger.error({ orderId, error }, 'Error closing WebSocket');
    }
  }

  /**
   * Emit a status update to all connections tracking a specific order
   * @param orderId - The order ID
   * @param status - The new order status
   * @param data - Optional additional data (txHash, error, routing decision, etc.)
   */
  emitStatusUpdate(
    orderId: string,
    status: OrderStatus,
    data?: WebSocketMessage['data']
  ): void {
    const orderConnections = this.connections.get(orderId);
    
    if (!orderConnections || orderConnections.size === 0) {
      logger.debug({ orderId, status }, 'No WebSocket connections to emit status update');
      return;
    }

    const message: WebSocketMessage = {
      orderId,
      status,
      timestamp: Date.now(),
      data
    };

    const messageStr = JSON.stringify(message);
    const disconnectedSockets: WebSocket[] = [];

    // Send message to all connected clients
    for (const ws of orderConnections) {
      try {
        if (ws.readyState === WS_OPEN) {
          ws.send(messageStr);
          logger.debug({ orderId, status }, 'Status update sent to WebSocket client');
        } else {
          // Mark for removal if not open
          disconnectedSockets.push(ws);
        }
      } catch (error) {
        logger.error({ orderId, status, error }, 'Error sending WebSocket message');
        disconnectedSockets.push(ws);
      }
    }

    // Clean up disconnected sockets
    for (const ws of disconnectedSockets) {
      this.removeConnection(orderId, ws);
    }

    logger.info(
      { 
        orderId, 
        status, 
        connectedClients: orderConnections.size,
        disconnectedClients: disconnectedSockets.length 
      }, 
      'Status update emitted'
    );
  }

  /**
   * Remove all connections for a specific order (cleanup after order completion)
   * @param orderId - The order ID
   */
  removeAllConnections(orderId: string): void {
    const orderConnections = this.connections.get(orderId);
    if (!orderConnections) {
      return;
    }

    // Close all connections gracefully
    for (const ws of orderConnections) {
      try {
        if (ws.readyState === WS_OPEN) {
          ws.close();
        }
      } catch (error) {
        logger.error({ orderId, error }, 'Error closing WebSocket during cleanup');
      }
    }

    this.connections.delete(orderId);
    logger.info({ orderId }, 'All WebSocket connections cleaned up for order');
  }

  /**
   * Get the number of active connections for a specific order
   * @param orderId - The order ID
   * @returns The number of active connections
   */
  getConnectionCount(orderId: string): number {
    const orderConnections = this.connections.get(orderId);
    return orderConnections ? orderConnections.size : 0;
  }

  /**
   * Get the total number of active connections across all orders
   * @returns The total number of active connections
   */
  getTotalConnectionCount(): number {
    let total = 0;
    for (const connections of this.connections.values()) {
      total += connections.size;
    }
    return total;
  }

  /**
   * Gracefully close all WebSocket connections (for server shutdown)
   */
  closeAll(): void {
    logger.info({ totalOrders: this.connections.size }, 'Closing all WebSocket connections');

    for (const [orderId, orderConnections] of this.connections.entries()) {
      for (const ws of orderConnections) {
        try {
          if (ws.readyState === WS_OPEN) {
            ws.close();
          }
        } catch (error) {
          logger.error({ orderId, error }, 'Error closing WebSocket during shutdown');
        }
      }
    }

    this.connections.clear();
    logger.info('All WebSocket connections closed');
  }
}
