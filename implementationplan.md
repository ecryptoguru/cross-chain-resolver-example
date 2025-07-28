# 1inch Fusion+ x NEAR Protocol Cross-Chain Swap (Hackathon Implementation)

## Project Status: In Progress
**Last Updated:** 2025-07-28

## Important Hackathon Constraints
- **No Production API Access**: Using local contract interactions only
- **Local Development**: Testing with local nodes and forked networks
- **Not Broadcast to Live Network**: All testing is local to the development environment
- **Use Provided Contracts**: Extending `Resolver` and `TestEscrowFactory` contracts
- **Foundry**: Using Foundry instead of Hardhat for Ethereum development
- **OpenZeppelin v4.9.5**: Using for secure contract development

## Current Progress

### ✅ Phase 1: Research & Design (Completed)
- System architecture designed
- Protocol integration specifications defined
- Security model and TEE requirements established

### 🚧 Phase 2: NEAR Side Implementation (In Progress)

#### 2.1 Shade Agent Development
- [x] Project setup with TEE environment
- [x] Build pipeline configured
- [x] Core agent logic implemented
  - [x] Event listening
  - [x] Order processing
  - [x] State management

#### 2.2 NEAR Smart Contracts
- [x] Escrow contract with custody, hashlock, and timelock
- [x] Bridge contract for cross-chain communication
- [x] Comprehensive input validation
- [x] Event emission system
- [ ] TEE attestation verification

#### 2.3 Chain Signatures Integration
- [x] Basic signing logic
- [ ] TEE key management
- [ ] Transaction construction

### ⏳ Upcoming Phases

## Phase 3: 1inch Fusion+ Meta-Order Integration (1 day)
- [ ] Construct valid 1inch Fusion+ meta-orders
  - [ ] Implement order creation with Fusion SDK
  - [ ] Add NEAR Chain Signatures for order signing
  - [ ] Validate order parameters
- [ ] Local order lifecycle management
  - [ ] Order matching
  - [ ] Order filling
  - [ ] Cancellation handling
  - [ ] Error recovery

## Phase 4: Ethereum Side Implementation (1 day)
- [ ] Extend Resolver contract
  - [ ] Add NEAR-specific validation
  - [ ] Implement cross-chain verification
- [ ] Local order management
  - [ ] Order validation
  - [ ] Event monitoring
  - [ ] Status tracking

## Phase 5: Cross-Chain Communication (1 day)
- [ ] Local relayer implementation
  - [ ] Message queue
  - [ ] Retry mechanism
  - [ ] Signature verification
  - [ ] Nonce management
- [ ] State synchronization
  - [ ] Chain reorganization handling
  - [ ] Finality checks

## Phase 6: Testing & Security (1 day)
- [ ] Unit testing
  - [ ] Contract tests
  - [ ] Integration tests
  - [ ] Edge case testing
- [ ] Security audit
  - [ ] Code review
  - [ ] Formal verification
  - [ ] Penetration testing

## Phase 7: Testnet Deployment (1 day)
- [ ] Deploy to NEAR testnet
- [ ] Deploy to Ethereum testnet (Sepolia)
- [ ] End-to-end testing
- [ ] Demo preparation

## Technical Stack

### NEAR Side
- **Language**: Rust
- **Frameworks**:
  - NEAR SDK
  - Shade Agent Framework
  - TEE (Intel SGX)
  - Chain Signatures

### Ethereum Side
- **Language**: Solidity 0.8.23
- **Frameworks**:
  - Foundry
  - OpenZeppelin Contracts v4.9.5
  - 1inch Fusion SDK

### Infrastructure
- **Relayer**: Node.js/TypeScript
- **Testing**: Local testnet, forked networks
- **Monitoring**: Console logs, custom events

### 5.1 Unit Testing
- Smart contract tests
- Agent logic tests
- Integration tests

### 5.2 Security Audits
- Code review
- Formal verification (where applicable)
- Penetration testing

### 5.3 Local Network Testing
- Deploy to local forked networks
- End-to-end testing with local nodes
- Basic load testing with local simulation
- Dry run testnet deployment

## Phase 6: Testnet Deployment (1 days)

### 6.1 Testnet Setup
- Deploy contracts to testnets
  - Ethereum: Goerli/Sepolia
  - NEAR: Testnet
- Fund test wallets with test tokens
- Configure cross-chain communication

### 6.2 On-chain Demo Preparation
- Prepare test scenarios for both directions:
  - ETH/ERC20 → NEAR
  - NEAR → ETH/ERC20
- Create verification scripts
  - Check contract states
  - Verify token balances
  - Monitor cross-chain events
- Prepare block explorer links for demo

## Phase 7: Demo & Documentation (1 days)

### 7.1 Live Demo Preparation
- Script demo flow with testnet deployment
- Prepare verification steps
  - Transaction hashes
  - Contract states
  - Cross-chain verification
- Create backup recording

### 7.2 Documentation
- Architecture documentation
- API documentation
- User guides
- Deployment guide

## Phase 8: Stretch Goals

### 7.1 UI Development
- Basic swap interface
- Transaction monitoring
- History and status

### 7.2 Partial Fills
- Order splitting
- Partial fulfillment logic
- Refund handling

### 8.1 UI Development
- Basic swap interface
- Transaction monitoring
- History and status

### 8.2 Partial Fills
- Order splitting
- Partial fulfillment logic
- Refund handling

### 8.3 Relayer Enhancement
- Improve relayer reliability
- Add comprehensive logging
- Monitoring and alerting

## Technical Stack

### NEAR Side
- **Language**: Rust
- **Frameworks**: NEAR SDK, Shade Agent Framework
- **TEE**: Intel SGX
- **Key Management**: NEAR Chain Signatures

### Ethereum Side
- **Language**: Solidity, TypeScript
- **Frameworks**: Hardhat, ethers.js
- **Libraries**: 1inch Fusion+ SDK
- **Base Contracts**: Extend from provided `Resolver` and `TestEscrowFactory`

### Infrastructure
- **Relayer**: Node.js/Typescript
- **Monitoring**: Prometheus, Grafana
- **CI/CD**: GitHub Actions
- **Testnet Faucets**:
  - Ethereum: Goerli/Sepolia faucets
  - NEAR: Testnet wallet
- **Block Explorers**:
  - Etherscan/Blockscout
  - NEAR Explorer

## Next Steps
1. Begin with Phase 1.1 (System Architecture Design)
2. Set up development environments
3. Start implementing core components in parallel