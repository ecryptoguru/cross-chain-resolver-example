# Cross-Chain Relayer (NEAR + Ethereum)

This is the relayer service for the 1inch Fusion+ x NEAR Protocol cross-chain swap solution. The relayer monitors events on both Ethereum and NEAR blockchains, facilitating secure and efficient cross-chain communication between them.

## Features

- **Bidirectional Cross-Chain Swaps**: Enables seamless token swaps between NEAR and Ethereum
- **Event Monitoring**: Tracks escrow creation, fulfillment, and cancellation events on both chains
- **Message Relaying**: Handles secure message passing between NEAR and Ethereum
- **Robust Error Handling**: Implements retry mechanisms and error recovery
- **Configurable Polling**: Adjustable intervals for block scanning and event processing
- **Extensive Logging**: Detailed logs for monitoring and debugging
- **Modular Architecture**: Easy to extend with additional blockchain integrations

## Prerequisites

- Node.js (v18 or higher)
- pnpm (recommended) or npm
- Rust (for NEAR smart contract development)
- NEAR CLI (for NEAR account management)
- Git
- Docker and Docker Compose (for local development and testing)

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd cross-chain-resolver-example/relayer
   ```

2. Install dependencies:
   ```bash
   pnpm install
   # or
   npm install
   ```

3. Copy the example environment file and update with your configuration:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

## Configuration

### Environment Variables

Update the `.env` file with your configuration:

```env
# Ethereum Configuration
ETHEREUM_RPC_URL=http://localhost:8545
ETHEREUM_CHAIN_ID=31337
ETHEREUM_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# NEAR Configuration
NEAR_NETWORK=testnet
NEAR_NODE_URL=https://rpc.testnet.near.org
NEAR_WALLET_URL=https://wallet.testnet.near.org
NEAR_HELPER_URL=https://helper.testnet.near.org
NEAR_ACCOUNT_ID=your-near-account.testnet
NEAR_PRIVATE_KEY=ed25519:...

# Relayer Configuration
RELAYER_POLL_INTERVAL=5000  # 5 seconds
LOG_LEVEL=info              # debug, info, warn, error
MAX_RETRIES=3               # Maximum retry attempts for failed operations
RETRY_DELAY=5000           # Delay between retries in ms

# Contract Addresses
ETHEREUM_ESCROW_CONTRACT=0x...
NEAR_ESCROW_CONTRACT=escrow.your-account.testnet

# Monitoring (Optional)
PROMETHEUS_PORT=9090
GRAFANA_PORT=3001
```

### Network Configuration

#### Testnet
- **Ethereum**: Sepolia Testnet (Chain ID: 11155111)
- **NEAR**: Testnet

#### Mainnet
- **Ethereum**: Mainnet (Chain ID: 1)
- **NEAR**: Mainnet

## Running the Relayer

### Local Development

1. Start the relayer in development mode:
   ```bash
   pnpm dev
   # or
   npm run dev
   ```

2. Run tests:
   ```bash
   pnpm test
   # or
   npm test
   ```

### Production Deployment

1. Build the application:
   ```bash
   pnpm build
   ```

2. Start the relayer:
   ```bash
   pnpm start
   ```

## Cross-Chain Flow

### NEAR to Ethereum Swap
1. User initiates a swap on NEAR
2. NEAR contract emits a `DepositInitiated` event
3. Relayer picks up the event and processes the deposit
4. Funds are locked in the NEAR escrow
5. Relayer submits the transaction to Ethereum
6. Funds are released to the recipient on Ethereum

### Ethereum to NEAR Swap
1. User initiates a swap on Ethereum
2. Ethereum contract emits a `DepositInitiated` event
3. Relayer picks up the event and processes the deposit
4. Funds are locked in the Ethereum escrow
5. Relayer submits the transaction to NEAR
6. Funds are released to the recipient on NEAR

## Monitoring and Metrics

The relayer includes built-in monitoring capabilities using Prometheus and Grafana.

### Available Metrics

- **Ethereum Events Processed**: Counter for processed Ethereum events
- **NEAR Events Processed**: Counter for processed NEAR events
- **Active Connections**: Current number of active connections
- **Ethereum Block Height**: Current Ethereum block height
- **NEAR Block Height**: Current NEAR block height
- **Message Processing Latency**: Time taken to process cross-chain messages
- **Error Rates**: Count of failed operations by type

### Accessing Metrics

1. Prometheus metrics are available at `http://localhost:3000/metrics`
2. Health check endpoint at `http://localhost:3000/health`

### Setting Up Monitoring Stack

1. Start the monitoring stack using Docker Compose:
   ```bash
   docker-compose -f docker-compose.monitoring.yml up -d
   ```

2. Access the monitoring dashboards:
   - Prometheus: http://localhost:9090
   - Grafana: http://localhost:3001 (admin/admin)

## Security Considerations

1. **Private Keys**: Never commit private keys to version control
2. **Rate Limiting**: Implement rate limiting for RPC endpoints
3. **Gas Management**: Monitor gas prices and set appropriate limits
4. **Error Handling**: Implement comprehensive error handling and alerting
5. **Upgrades**: Keep all dependencies up to date

## Deployment

### Prerequisites

- Docker and Docker Compose
- Node.js 18+ and pnpm/npm
- Access to Ethereum and NEAR nodes

### Environment Variables

Create a `.env` file with the following variables:

```env
# Ethereum Configuration
ETHEREUM_RPC_URL=
ETHEREUM_PRIVATE_KEY=
ETHEREUM_ESCROW_FACTORY_ADDRESS=

# NEAR Configuration
NEAR_NETWORK=testnet
NEAR_NODE_URL=
NEAR_ACCOUNT_ID=
NEAR_PRIVATE_KEY=
NEAR_ESCROW_FACTORY_ADDRESS=

# Relayer Configuration
LOG_LEVEL=info
POLLING_INTERVAL=5000
```

### Building the Docker Image

```bash
docker build -t cross-chain-relayer .
```

### Running with Docker Compose

1. Update the environment variables in `docker-compose.yml`
2. Start the service:
   ```bash
   docker-compose up -d relayer
   ```

### Kubernetes Deployment

For production deployments, you can use the provided Kubernetes manifests in the `k8s/` directory.

## Running the Relayer

### Development Mode

```bash
pnpm dev
# or
npm run dev
```

### Production Mode

1. Build the project:
   ```bash
   pnpm build
   # or
   npm run build
   ```

2. Start the relayer:
   ```bash
   pnpm start
   # or
   npm start
   ```

## Logging

The relayer uses Winston for logging. Logs are output to the console and saved to files in the `logs` directory.

Available log levels:
- `error`: Error information
- `warn`: Warning messages
- `info`: General information (default)
- `http`: HTTP request logging
- `debug`: Debug information

To change the log level, set the `LOG_LEVEL` environment variable in your `.env` file.

## Architecture

The relayer consists of two main components:

1. **Ethereum Relayer**: Monitors Ethereum for escrow events and handles cross-chain operations to NEAR.
2. **NEAR Relayer**: Monitors NEAR for deposit/withdrawal events and handles cross-chain operations to Ethereum.

## Development

### Directory Structure

```
relayer/
├── src/
│   ├── ethereum/        # Ethereum-specific code
│   ├── near/            # NEAR-specific code
│   ├── relay/           # Relayer implementation
│   ├── types/           # TypeScript type definitions
│   ├── utils/           # Utility functions
│   └── index.ts         # Entry point
├── test/                # Test files
├── .env.example         # Example environment variables
├── package.json         # Project configuration
└── tsconfig.json        # TypeScript configuration
```

### Adding New Event Handlers

1. Add a new method to the appropriate relayer class (`EthereumRelayer` or `NearRelayer`).
2. Implement the event handling logic in the method.
3. Update the event listener setup to call your new method when the event is detected.

## Testing

To run the test suite:

```bash
pnpm test
# or
npm test
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
