1. Prerequisites

First, let's install the necessary system dependencies:
# Install Node.js (v22+)
nvm install 22
nvm use 22

# Install pnpm
npm install -g pnpm

# Install Foundry (for Ethereum development)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Install Rust (for NEAR development)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# Install NEAR CLI
npm install -g near-cli

2. Project Setup

# Clone the repository (if not already done)
git clone https://github.com/1inch/cross-chain-resolver-example.git
cd cross-chain-resolver-example

# Install Node.js dependencies
pnpm install

# Install Foundry dependencies
forge install

# Install Rust dependencies (for NEAR development)
cargo install cargo-near

3. Environment Configuration

Create a .env file in the project root with the following variables:

.env
# Ethereum RPC URLs (replace with your own or use public ones)
SRC_CHAIN_RPC=https://eth.merkle.io
DST_CHAIN_RPC=wss://bsc-rpc.publicnode.com

# NEAR Configuration
NEAR_NETWORK=testnet
NEAR_ACCOUNT_ID=your-account.testnet
NEAR_KEY_PATH=~/.near-credentials/testnet/your-account.testnet.json

# Optional: For local development
ANVIL_FORK_URL=https://eth-mainnet.g.alchemy.com/v2/your-api-key

4. NEAR Development Setup

# Create a testnet account (if you don't have one)
near login

# Initialize NEAR project structure
mkdir -p near-contracts
cd near-contracts
cargo near new escrow
cd escrow

5. Development Tools

For Ethereum Development:
Hardhat: Already included in the project
Foundry: For testing and deployment
Ethers.js: For interacting with Ethereum
For NEAR Development:
NEAR CLI: For deployment and interaction
cargo-near: For building and testing NEAR contracts
near-cli-rs: For better CLI experience (optional)

6. Testing the Setup

# Run Ethereum tests
pnpm test

# Run NEAR tests (from near-contracts/escrow)
cargo test

7. Development Workflow

Ethereum Development:
Write and test Solidity contracts in contracts/
Run tests with pnpm test
Deploy to testnet using Hardhat or Foundry

NEAR Development:
Write and test Rust contracts in near-contracts/
Deploy to testnet:

cd near-contracts/escrow
cargo near deploy --account-id your-account.testnet
Integration Testing:


8. Local Development Networks
For local development, you can use:

# Start a local Ethereum node (Anvil)
anvil

# In a new terminal, deploy contracts to local node
pnpm deploy:local

# For NEAR local development
nearup run testnet

9. Useful Scripts

Add these to your package.json scripts:

json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "compile": "hardhat compile",
    "deploy:testnet": "hardhat run scripts/deploy.ts --network testnet",
    "deploy:mainnet": "hardhat run scripts/deploy.ts --network mainnet",
    "deploy:local": "hardhat run scripts/deploy.ts --network localhost",
    "node": "hardhat node",
    "fork": "hardhat node --fork $RPC_URL"
  }
}

10. IDE Setup
For better development experience:

VS Code Extensions:
Solidity (by Juan Blanco)
Rust Analyzer
Hardhat
ESLint
Prettier

Recommended Settings:
json
{
  "solidity.packageDefaultDependenciesContractsDirectory": "contracts/src",
  "solidity.packageDefaultDependenciesDirectory": "contracts/lib",
  "rust-analyzer.check.command": "clippy",
  "editor.formatOnSave": true
}

11. Next Steps

Verify the setup by running tests:
pnpm test

Start developing by:
Adding new contracts to contracts/src/
Writing tests in tests/
Implementing the NEAR integration in near-contracts/

For debugging:
Use console.log in Solidity
Use near-cli for NEAR contract interaction
Use Hardhat's console.log for Ethereum debugging

## Running

To run tests you need to provide fork urls for Ethereum and Bsc

```shell
SRC_CHAIN_RPC=ETH_FORK_URL DST_CHAIN_RPC=BNB_FORK_URL pnpm test
```

### Public rpc

| Chain    | Url                          |
|----------|------------------------------|
| Ethereum | https://eth.merkle.io        |
| BSC      | wss://bsc-rpc.publicnode.com |

## Test accounts

### Available Accounts

```
(0) 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" Owner of EscrowFactory
(1) 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" User
(2) 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" Resolver
```
Test