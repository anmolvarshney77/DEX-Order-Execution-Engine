-- Create orders table
CREATE TABLE IF NOT EXISTS orders (
  order_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_in VARCHAR(44) NOT NULL,
  token_out VARCHAR(44) NOT NULL,
  amount BIGINT NOT NULL,
  slippage DECIMAL(5,4) NOT NULL DEFAULT 0.01,
  status VARCHAR(20) NOT NULL,
  selected_dex VARCHAR(20),
  tx_hash VARCHAR(88),
  executed_price DECIMAL(20,10),
  input_amount BIGINT,
  output_amount BIGINT,
  failure_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMP
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_tx_hash ON orders(tx_hash);

-- Create order status history table
CREATE TABLE IF NOT EXISTS order_status_history (
  id SERIAL PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  metadata JSONB
);

-- Create index for order status history
CREATE INDEX IF NOT EXISTS idx_order_status_history_order_id ON order_status_history(order_id);
CREATE INDEX IF NOT EXISTS idx_order_status_history_timestamp ON order_status_history(timestamp DESC);

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
