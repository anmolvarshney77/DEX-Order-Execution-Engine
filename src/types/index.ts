export type OrderStatus = 'pending' | 'routing' | 'building' | 'submitted' | 'confirmed' | 'failed';

export type DexType = 'raydium' | 'meteora';

export interface OrderRequest {
  tokenIn: string;
  tokenOut: string;
  amount: number;
  slippage?: number;
}

export interface OrderResponse {
  orderId: string;
  status: 'pending';
  timestamp: number;
}

export interface WebSocketMessage {
  orderId: string;
  status: OrderStatus;
  timestamp: number;
  data?: {
    txHash?: string;
    executedPrice?: number;
    error?: string;
    routingDecision?: {
      selectedDex: DexType;
      raydiumPrice: number;
      meteoraPrice: number;
    };
  };
}

export interface OrderRecord {
  orderId: string;
  tokenIn: string;
  tokenOut: string;
  amount: number;
  slippage: number;
  status: OrderStatus;
  selectedDex?: DexType;
  txHash?: string;
  executedPrice?: number;
  inputAmount?: number;
  outputAmount?: number;
  failureReason?: string;
  createdAt: Date;
  updatedAt: Date;
  confirmedAt?: Date;
}

export interface OrderJob {
  orderId: string;
  tokenIn: string;
  tokenOut: string;
  amount: number;
  slippage: number;
  attempt: number;
}

export interface DexQuote {
  dex: DexType;
  price: number;
  fee: number;
  effectivePrice: number;
  poolId?: string;
  estimatedOutput: number;
}

export interface SwapParams {
  dex: DexType;
  tokenIn: string;
  tokenOut: string;
  amount: number;
  minAmountOut: number;
  poolId?: string;
}

export interface SwapResult {
  txHash: string;
  executedPrice: number;
  inputAmount: number;
  outputAmount: number;
  fee: number;
  timestamp: number;
}
