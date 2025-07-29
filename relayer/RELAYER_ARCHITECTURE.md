# Relayer Architecture Documentation

## Overview

The Cross-Chain Relayer system enables secure and reliable communication between Ethereum and NEAR networks for the 1inch Fusion+ cross-chain swap protocol. It implements a bidirectional message relay with robust error handling, signature verification, and persistent state management.

## Architecture Components

### 1. Core Relayer Classes

#### EthereumRelayer (`src/relay/ethereum.ts`)
- **Purpose**: Monitors Ethereum blockchain for cross-chain events and processes them
- **Key Features**:
  - Event polling with configurable intervals
  - Message queue management
  - Signature verification using EIP-712
  - Retry logic with exponential backoff
  - Persistent message tracking

#### NearRelayer (`src/relay/near.ts`)
- **Purpose**: Monitors NEAR blockchain for cross-chain events and processes them
- **Key Features**:
  - Block-by-block transaction processing
  - Chunk-based event extraction
  - Cross-chain message construction
  - Ethereum escrow fulfillment
  - State synchronization

### 2. Message Flow Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Ethereum      │    │     Relayer     │    │      NEAR       │
│   Network       │    │     System      │    │     Network     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │  1. Deposit Event     │                       │
         ├──────────────────────►│                       │
         │                       │  2. Process & Queue   │
         │                       ├──────────────────────►│
         │                       │                       │
         │                       │  3. NEAR Transaction  │
         │                       │◄──────────────────────┤
         │  4. Update Status     │                       │
         │◄──────────────────────┤                       │
```

### 3. Event Processing Pipeline

#### Ethereum → NEAR Flow
1. **Event Detection**: EthereumRelayer polls for `DepositInitiated` events
2. **Message Construction**: Creates cross-chain message with:
   - Deposit ID and amount
   - Secret hash for hashlock
   - Timelock expiration
   - Target NEAR account
3. **Signature Generation**: Signs message using relayer's private key
4. **NEAR Submission**: Submits transaction to NEAR escrow contract
5. **Status Update**: Updates Ethereum escrow status upon confirmation

#### NEAR → Ethereum Flow
1. **Block Processing**: NearRelayer processes blocks and chunks
2. **Transaction Analysis**: Extracts escrow-related transactions
3. **Event Extraction**: Identifies fulfillment or refund events
4. **Ethereum Interaction**: Calls Ethereum escrow contracts
5. **Confirmation**: Waits for transaction confirmation

## Configuration

### Environment Variables

```bash
# Ethereum Configuration
ETHEREUM_RPC_URL=https://eth-mainnet.alchemyapi.io/v2/your-key
ETHEREUM_CHAIN_ID=1
DEPLOYER_PRIVATE_KEY=0x...

# NEAR Configuration
NEAR_NETWORK=mainnet
NEAR_NODE_URL=https://rpc.mainnet.near.org
NEAR_ACCOUNT_ID=your-relayer.near
NEAR_PRIVATE_KEY=ed25519:...

# Relayer Configuration
RELAYER_POLL_INTERVAL=5000
RESOLVER_ADDRESS=0x...
ESCROW_FACTORY_ADDRESS=0x...
NEAR_ESCROW_CONTRACT_ID=escrow.near
```

### Relayer Configuration Parameters

```typescript
const RELAYER_CONFIG = {
  MAX_RETRIES: 3,           // Maximum retry attempts
  RETRY_DELAY: 5000,        // Delay between retries (ms)
  BLOCK_LOOKBACK: 100,      // Blocks to process on startup
  MAX_PARALLEL_BLOCKS: 5,   // Parallel block processing limit
  MESSAGE_EXPIRY: 604800,   // Message expiry time (1 week)
  POLL_INTERVAL: 5000       // Event polling interval (ms)
};
```

## Security Features

### 1. Signature Verification
- **EIP-712 Structured Data**: All Ethereum messages use EIP-712 for type-safe signing
- **Multi-Signature Support**: Requires multiple relayer confirmations for withdrawals
- **Nonce Management**: Prevents replay attacks with incremental nonces

### 2. Message Authentication
- **Cryptographic Hashing**: Messages include cryptographic hashes for integrity
- **Timestamp Validation**: Messages expire after configured time period
- **Chain ID Verification**: Prevents cross-chain replay attacks

### 3. Error Handling
- **Retry Logic**: Failed operations retry with exponential backoff
- **Circuit Breaker**: Stops processing if error rate exceeds threshold
- **Graceful Degradation**: Continues processing other messages if one fails

## State Management

### 1. Persistent Storage
- **Processed Messages**: Tracks processed message IDs to prevent duplicates
- **Block Heights**: Maintains last processed block for each chain
- **Retry Counters**: Tracks retry attempts for failed operations

### 2. In-Memory State
- **Message Queue**: Pending messages awaiting processing
- **Relayer Status**: Active/inactive status of relayers
- **Connection Health**: Network connection status monitoring

## Monitoring and Observability

### 1. Logging
- **Structured Logging**: JSON-formatted logs with correlation IDs
- **Log Levels**: DEBUG, INFO, WARN, ERROR with configurable verbosity
- **Event Tracking**: Detailed logs for all cross-chain events

### 2. Metrics
- **Processing Metrics**: Message throughput, latency, success rates
- **Error Metrics**: Error counts by type and chain
- **Health Metrics**: Connection status, block sync status

### 3. Alerting
- **Failed Transactions**: Alerts on transaction failures
- **High Error Rates**: Alerts when error rate exceeds threshold
- **Connection Issues**: Alerts on network connectivity problems

## Deployment Architecture

### 1. Production Deployment
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Load Balancer │    │   Relayer Pod   │    │   Monitoring    │
│                 │    │                 │    │                 │
│  ┌───────────┐  │    │  ┌───────────┐  │    │  ┌───────────┐  │
│  │  Health   │  │    │  │ Ethereum  │  │    │  │Prometheus │  │
│  │  Check    │  │    │  │ Relayer   │  │    │  │           │  │
│  └───────────┘  │    │  └───────────┘  │    │  └───────────┘  │
│                 │    │                 │    │                 │
│  ┌───────────┐  │    │  ┌───────────┐  │    │  ┌───────────┐  │
│  │  Metrics  │  │    │  │   NEAR    │  │    │  │  Grafana  │  │
│  │ Endpoint  │  │    │  │ Relayer   │  │    │  │           │  │
│  └───────────┘  │    │  └───────────┘  │    │  └───────────┘  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### 2. High Availability
- **Multiple Relayer Instances**: Run multiple instances for redundancy
- **Leader Election**: Use consensus mechanism for active relayer selection
- **Failover Logic**: Automatic failover to backup relayers

## API Endpoints

### Health Check
```
GET /health
Response: {
  "status": "healthy",
  "ethereum": {
    "connected": true,
    "lastBlock": 18500000,
    "latency": 150
  },
  "near": {
    "connected": true,
    "lastBlock": 105000000,
    "latency": 200
  }
}
```

### Metrics
```
GET /metrics
Response: Prometheus-formatted metrics
```

### Status
```
GET /status
Response: {
  "relayers": {
    "ethereum": {
      "running": true,
      "processedMessages": 1250,
      "failedMessages": 5,
      "lastProcessed": "2024-01-15T10:30:00Z"
    },
    "near": {
      "running": true,
      "processedMessages": 1180,
      "failedMessages": 3,
      "lastProcessed": "2024-01-15T10:29:45Z"
    }
  }
}
```

## Troubleshooting

### Common Issues

1. **Connection Timeouts**
   - Check RPC endpoint availability
   - Verify network connectivity
   - Increase timeout configuration

2. **Signature Verification Failures**
   - Verify relayer private keys
   - Check nonce synchronization
   - Validate EIP-712 domain separator

3. **Message Processing Delays**
   - Check block confirmation times
   - Verify gas prices for Ethereum
   - Monitor NEAR network congestion

### Debug Commands

```bash
# Check relayer logs
docker logs relayer-container

# Verify configuration
curl http://localhost:3000/status

# Monitor metrics
curl http://localhost:3000/metrics | grep relayer_
```

## Development Setup

### Local Development
```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your configuration

# Run tests
npm test

# Start relayer
npm start
```

### Docker Development
```bash
# Build image
docker build -t cross-chain-relayer .

# Run container
docker run -d \
  --name relayer \
  --env-file .env \
  -p 3000:3000 \
  cross-chain-relayer
```

## Future Enhancements

1. **Dynamic Relayer Management**: Add/remove relayers without restart
2. **Advanced Retry Strategies**: Implement more sophisticated retry policies
3. **Cross-Chain Analytics**: Detailed analytics dashboard
4. **Automated Testing**: Comprehensive end-to-end test suite
5. **Performance Optimization**: Batch processing and parallel execution
