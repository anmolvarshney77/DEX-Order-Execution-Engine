import { getPool } from './database.js';
import type { OrderRecord, OrderStatus } from '../types/index.js';

/**
 * Repository for managing order persistence in PostgreSQL
 */
export class OrderRepository {
  /**
   * Create a new order record
   */
  async create(
    order: Omit<OrderRecord, 'orderId' | 'createdAt' | 'updatedAt'>
  ): Promise<OrderRecord> {
    const pool = getPool();
    
    const query = `
      INSERT INTO orders (
        token_in, token_out, amount, slippage, status,
        selected_dex, tx_hash, executed_price, input_amount,
        output_amount, failure_reason, confirmed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING 
        order_id as "orderId",
        token_in as "tokenIn",
        token_out as "tokenOut",
        amount,
        slippage,
        status,
        selected_dex as "selectedDex",
        tx_hash as "txHash",
        executed_price as "executedPrice",
        input_amount as "inputAmount",
        output_amount as "outputAmount",
        failure_reason as "failureReason",
        created_at as "createdAt",
        updated_at as "updatedAt",
        confirmed_at as "confirmedAt"
    `;

    const values = [
      order.tokenIn,
      order.tokenOut,
      order.amount,
      order.slippage,
      order.status,
      order.selectedDex || null,
      order.txHash || null,
      order.executedPrice || null,
      order.inputAmount || null,
      order.outputAmount || null,
      order.failureReason || null,
      order.confirmedAt || null,
    ];

    const result = await pool.query(query, values);
    const createdOrder = this.parseOrderRecord(result.rows[0]);

    // Record initial status in history
    await this.recordStatusHistory(createdOrder.orderId, order.status);

    return createdOrder;
  }

  /**
   * Update order status and optionally other fields
   */
  async updateStatus(
    orderId: string,
    status: OrderStatus,
    data?: Partial<OrderRecord>
  ): Promise<void> {
    const pool = getPool();

    // Build dynamic update query based on provided data
    const updates: string[] = ['status = $2'];
    const values: any[] = [orderId, status];
    let paramIndex = 3;

    if (data?.selectedDex !== undefined) {
      updates.push(`selected_dex = $${paramIndex}`);
      values.push(data.selectedDex);
      paramIndex++;
    }

    if (data?.txHash !== undefined) {
      updates.push(`tx_hash = $${paramIndex}`);
      values.push(data.txHash);
      paramIndex++;
    }

    if (data?.executedPrice !== undefined) {
      updates.push(`executed_price = $${paramIndex}`);
      values.push(data.executedPrice);
      paramIndex++;
    }

    if (data?.inputAmount !== undefined) {
      updates.push(`input_amount = $${paramIndex}`);
      values.push(data.inputAmount);
      paramIndex++;
    }

    if (data?.outputAmount !== undefined) {
      updates.push(`output_amount = $${paramIndex}`);
      values.push(data.outputAmount);
      paramIndex++;
    }

    if (data?.failureReason !== undefined) {
      updates.push(`failure_reason = $${paramIndex}`);
      values.push(data.failureReason);
      paramIndex++;
    }

    if (status === 'confirmed') {
      updates.push(`confirmed_at = NOW()`);
    }

    const query = `
      UPDATE orders
      SET ${updates.join(', ')}
      WHERE order_id = $1
    `;

    await pool.query(query, values);

    // Record status change in history
    await this.recordStatusHistory(orderId, status, data);
  }

  /**
   * Find order by ID
   */
  async findById(orderId: string): Promise<OrderRecord | null> {
    const pool = getPool();

    const query = `
      SELECT 
        order_id as "orderId",
        token_in as "tokenIn",
        token_out as "tokenOut",
        amount,
        slippage,
        status,
        selected_dex as "selectedDex",
        tx_hash as "txHash",
        executed_price as "executedPrice",
        input_amount as "inputAmount",
        output_amount as "outputAmount",
        failure_reason as "failureReason",
        created_at as "createdAt",
        updated_at as "updatedAt",
        confirmed_at as "confirmedAt"
      FROM orders
      WHERE order_id = $1
    `;

    const result = await pool.query(query, [orderId]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.parseOrderRecord(result.rows[0]);
  }

  /**
   * Find recent orders
   */
  async findRecent(limit: number = 100): Promise<OrderRecord[]> {
    const pool = getPool();

    const query = `
      SELECT 
        order_id as "orderId",
        token_in as "tokenIn",
        token_out as "tokenOut",
        amount,
        slippage,
        status,
        selected_dex as "selectedDex",
        tx_hash as "txHash",
        executed_price as "executedPrice",
        input_amount as "inputAmount",
        output_amount as "outputAmount",
        failure_reason as "failureReason",
        created_at as "createdAt",
        updated_at as "updatedAt",
        confirmed_at as "confirmedAt"
      FROM orders
      ORDER BY created_at DESC
      LIMIT $1
    `;

    const result = await pool.query(query, [limit]);
    return result.rows.map(row => this.parseOrderRecord(row));
  }

  /**
   * Record status change in history table
   */
  private async recordStatusHistory(
    orderId: string,
    status: OrderStatus,
    metadata?: any
  ): Promise<void> {
    const pool = getPool();

    const query = `
      INSERT INTO order_status_history (order_id, status, metadata)
      VALUES ($1, $2, $3)
    `;

    await pool.query(query, [orderId, status, metadata ? JSON.stringify(metadata) : null]);
  }

  /**
   * Get status history for an order
   */
  async getStatusHistory(orderId: string): Promise<Array<{
    id: number;
    orderId: string;
    status: OrderStatus;
    timestamp: Date;
    metadata: any;
  }>> {
    const pool = getPool();

    const query = `
      SELECT 
        id,
        order_id as "orderId",
        status,
        timestamp,
        metadata
      FROM order_status_history
      WHERE order_id = $1
      ORDER BY timestamp ASC
    `;

    const result = await pool.query(query, [orderId]);
    return result.rows;
  }

  /**
   * Parse order record from database, converting string types to numbers
   */
  private parseOrderRecord(row: any): OrderRecord {
    return {
      orderId: row.orderId,
      tokenIn: row.tokenIn,
      tokenOut: row.tokenOut,
      amount: typeof row.amount === 'string' ? parseInt(row.amount, 10) : row.amount,
      slippage: typeof row.slippage === 'string' ? parseFloat(row.slippage) : row.slippage,
      status: row.status,
      selectedDex: row.selectedDex,
      txHash: row.txHash,
      executedPrice: row.executedPrice ? (typeof row.executedPrice === 'string' ? parseFloat(row.executedPrice) : row.executedPrice) : undefined,
      inputAmount: row.inputAmount ? (typeof row.inputAmount === 'string' ? parseInt(row.inputAmount, 10) : row.inputAmount) : undefined,
      outputAmount: row.outputAmount ? (typeof row.outputAmount === 'string' ? parseInt(row.outputAmount, 10) : row.outputAmount) : undefined,
      failureReason: row.failureReason,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      confirmedAt: row.confirmedAt,
    };
  }
}
