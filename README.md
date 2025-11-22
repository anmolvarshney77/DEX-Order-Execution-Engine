# DEX Order Execution Engine

A high-performance order execution engine with intelligent routing between Raydium and Meteora DEXs on Solana.

## Features

- **Intelligent DEX Routing**: Automatically compares prices across Raydium and Meteora to find the best execution venue
- **Real-time Updates**: WebSocket-based status streaming for order lifecycle tracking
- **Concurrent Processing**: BullMQ-powered queue system handling up to 10 concurrent orders
- **Slippage Protection**: Configurable slippage tolerance to protect against price movements
- **Persistent History**: PostgreSQL storage for order history and analytics
- **Fast Caching**: Redis-based caching for active order state
- **Mock & Real Execution**: Support for both mock implementation and real Solana devnet execution

## Architecture

The system follows a layered architecture:

1. **API Layer** (Fastify) - HTTP/WebSocket endpoints
2. **Queue Layer** (BullMQ) - Concurrent order processing with retry logic
3. **Routing Layer** - DEX price comparison and selection
4. **Execution Layer** - Swap execution on chosen DEX
5. **Persistence Layer** - PostgreSQL and Redis storage

## Prerequisites

- Node.js 18+ 
- Docker and Docker Compose (for local development)
- PostgreSQL 16+
- Redis 7+

## Quick Start

### 1. Clone and Install

```bash
npm install
```

### 2. Set Up Environment

```bash
cp .env.example .env
# Edit .env with your configuration
```

### 3. Start Infrastructure

```bash
docker-compose up -d
```

This starts:
- PostgreSQL on port 5432
- Redis on port 6379

### 4. Run Development Server

```bash
npm run dev
```

### 5. Run Tests

```bash
npm test
```

## Configuration

All configuration is managed through environment variables. See `.env.example` for available options.

Key configurations:
- `DEX_IMPLEMENTATION`: Set to `mock` for simulated execution or `real` for Solana devnet
- `QUEUE_CONCURRENCY`: Number of concurrent orders to process (default: 10)
- `DEFAULT_SLIPPAGE`: Default slippage tolerance (default: 0.01 = 1%)

## API Endpoints

### Submit Order

```http
POST /api/orders/execute
Content-Type: application/json

{
  "tokenIn": "So11111111111111111111111111111111111111112",
  "tokenOut": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "amount": 1000000,
  "slippage": 0.01
}
```

Response includes `orderId` and upgrades connection to WebSocket for status updates.

## Order Status Flow

1. `pending` - Order received and queued
2. `routing` - Comparing prices across DEXs
3. `building` - Building transaction
4. `submitted` - Transaction sent to blockchain
5. `confirmed` - Transaction confirmed (includes txHash)
6. `failed` - Order failed (includes error details)

## Development

### Project Structure

```
src/
├── api/          # Fastify server and WebSocket management
├── config/       # Configuration management
├── execution/    # Order execution logic
├── persistence/  # Database and cache operations
├── queue/        # BullMQ order processing
├── routing/      # DEX routing and price comparison
├── types/        # TypeScript type definitions
└── utils/        # Shared utilities
```

### Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm start` - Run production build
- `npm test` - Run tests
- `npm run test:watch` - Run tests in watch mode

## License

MIT
