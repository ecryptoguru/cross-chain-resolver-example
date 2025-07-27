# NEAR Solver for 1inch Fusion+ Cross-Chain Swaps

This is the NEAR-side solver component for the 1inch Fusion+ x NEAR cross-chain swap solution. It's built using NEAR's Shade Agent Framework and runs in a Trusted Execution Environment (TEE) for enhanced security.

## Features

- Processes cross-chain swap orders between Ethereum and NEAR
- Integrates with 1inch Fusion+ for order matching and execution
- Implements hashlock and timelock functionality for secure atomic swaps
- Provides a secure and efficient solver for cross-chain liquidity
- Built with NEAR's Shade Agent Framework for decentralized solver operation

## Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (latest stable version)
- [NEAR CLI](https://docs.near.org/tools/near-cli#setup)
- [cargo-near](https://github.com/near/cargo-near)
- [Node.js](https://nodejs.org/) (v16+)

## Project Structure

```
near-solver/
├── Cargo.toml           # Rust project configuration
├── README.md            # This file
├── src/
│   ├── lib.rs           # Main contract code
│   ├── model/           # Data models
│   │   └── order.rs     # Order data structures
│   ├── service/         # Business logic
│   │   └── solver.rs    # Solver implementation
│   └── utils/           # Utility functions
└── tests/               # Integration tests
```

## Building the Contract

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd cross-chain-resolver-example/near-solver
   ```

2. Build the contract in release mode:
   ```bash
   cargo build --target wasm32-unknown-unknown --release
   ```

   The compiled WebAssembly (WASM) file will be available at:
   ```
   target/wasm32-unknown-unknown/release/near_solver.wasm
   ```

## Testing

Run the unit tests:

```bash
cargo test -- --nocapture
```

## Deploying to NEAR Testnet

1. Make sure you have a NEAR testnet account with enough NEAR tokens.

2. Log in to your NEAR account using the CLI:
   ```bash
   near login
   ```

3. Deploy the contract to testnet:
   ```bash
   ./deploy.sh
   ```

   The deployment script will:
   - Build the contract
   - Create a sub-account for the solver (if needed)
   - Deploy the contract to the testnet
   - Initialize the contract with default settings

## Configuration

The solver can be configured by calling the following methods after deployment:

```typescript
// Initialize the contract (only once)
await contract.new({
  owner_id: 'your-account.testnet',
});

// Configure supported tokens
await contract.update_token_config({
  token_id: 'wrap.near',
  config: {
    min_amount: '1000000000000000000', // 1 wNEAR
    max_amount: '1000000000000000000000000', // 1M wNEAR
    fee_bps: 30, // 0.3%
    enabled: true,
  },
});
```

## Usage

### Processing an Order

To process a new cross-chain order:

```typescript
const order = {
  id: 'unique-order-id',
  source_chain: 'ethereum',
  source_token: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // ETH
  source_amount: '1000000000000000000', // 1 ETH
  source_address: '0x1234...',
  dest_chain: 'near',
  dest_token: 'wrap.near',
  dest_amount: '1000000000000000000000', // 1000 wNEAR
  dest_address: 'user.near',
  hashlock: '0x1234...',
  timelock: 1735689600, // Unix timestamp
};

// Call the contract
await contract.process_order(order);
```

### Checking Order Status

```typescript
const order = await contract.get_order_status({
  order_id: 'unique-order-id',
});

console.log('Order status:', order.status);
```

## Integration with Relayer

This solver is designed to work with the cross-chain relayer. The relayer will:

1. Monitor for new orders on the source chain (Ethereum or NEAR)
2. Forward valid orders to the solver
3. Monitor the solver's progress
4. Handle the completion or failure of orders

## Security Considerations

- The contract should be deployed in a Trusted Execution Environment (TEE)
- Only authorized addresses should be allowed to call sensitive methods
- All external calls should be properly validated
- The contract should be audited before mainnet deployment

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
