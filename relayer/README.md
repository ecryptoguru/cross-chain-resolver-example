# Cross-Chain Relayer

This is the relayer service for the 1inch Fusion+ x NEAR Protocol cross-chain swap solution. The relayer monitors events on both Ethereum and NEAR blockchains and facilitates cross-chain communication between them.

## Features

- Monitors Ethereum for escrow creation and fulfillment events
- Monitors NEAR for deposit and withdrawal events
- Handles cross-chain message passing between Ethereum and NEAR
- Provides a robust logging system for monitoring and debugging
- Configurable polling intervals and logging levels

## Prerequisites

- Node.js (v18 or higher)
- pnpm (recommended) or npm
- Rust (for NEAR smart contract development)
- NEAR CLI (for NEAR account management)

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

Update the `.env` file with your configuration:

```env
# Ethereum Configuration
ETHEREUM_RPC_URL=http://localhost:8545
ETHEREUM_CHAIN_ID=31337
DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# NEAR Configuration
NEAR_NETWORK=testnet
NEAR_NODE_URL=https://rpc.testnet.near.org
NEAR_WALLET_URL=https://wallet.testnet.near.org
NEAR_HELPER_URL=https://helper.testnet.near.org
NEAR_ACCOUNT_ID=your-near-account.testnet
NEAR_PRIVATE_KEY=ed25519:...

# Relayer Configuration
RELAYER_POLL_INTERVAL=5000 # 5 seconds
LOG_LEVEL=info

# Contract Addresses
ETHEREUM_ESCROW_FACTORY_ADDRESS=
NEAR_ESCROW_FACTORY_ADDRESS=
```

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
