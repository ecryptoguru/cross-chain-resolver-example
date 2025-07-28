# Cross-Chain Resolver Project Plan

## Notes
- Goal: Build a novel extension for 1inch Fusion+ enabling atomic swaps between Ethereum and NEAR.
- The solution requires a decentralized solver integrating 1inch Fusion+ with NEAR's Shade Agent Framework and Trusted Execution Environment (TEE).
- Solver must listen for quote requests, produce valid 1inch Fusion meta-orders using NEAR Chain Signatures, and demonstrate bidirectional swaps.
- Must preserve hashlock and timelock functionality for non-EVM (NEAR) implementation.
- Onchain execution of token transfers (mainnet/testnet) must be demonstrated.
- The NEAR-side agent/solver must:
  - Follow requirements in solver.md (Shade Agent Framework + TEE)
  - Be modeled after NEAR Intents solvers ([tee-solver](https://github.com/Near-One/tee-solver/), [near-intents-tee-amm-solver](https://github.com/think-in-universe/near-intents-tee-amm-solver/tree/feat/tee-solver))
  - Integrate with the defined meta-order/message formats for cross-chain swaps
  - Be compatible with 1inch Fusion+ meta-orders and NEAR Chain Signatures
- Demo must include live onchain execution of swaps on testnet or mainnet, as required by hackathon qualification.
- **Note:** Live onchain demo is a requirement for hackathon qualification.
- Bonus: Modular architecture, UI, partial fills, relayer, and resolver.
- Key NEAR tech: Chain Abstraction, Shade Agents, Chain Signatures, NEAR Intents.
- Reference implementations and documentation for both 1inch and NEAR components are available.
- Implementation plan in implementationplan.md is now synced with this plan (2025-07-28).
- For the hackathon, do NOT post orders to official 1inch REST APIs; work at the smart contract level using the provided contracts. All testing/filling is local and not broadcast to the live resolver set.
- Event emission and TEE attestation modules implemented as Rust modules (2025-07-28).
- Order model module implemented as Rust module (2025-07-28).
- Order model deduplicated and integrated in `model/order.rs` (2025-07-28).
- Comprehensive input validation and event emission implemented in order model (2025-07-28).
- TEE attestation module enhanced for comprehensive validation, error handling, and security (2025-07-28).
- TEE attestation module now supports additional TEE types (Asylo, Azure, AWS Nitro) and includes helper methods for production/cloud-based checks (2025-07-28).
- TEE attestation module now features detailed error types, comprehensive field validation, event emission, and improved struct fields for security and lifecycle management (2025-07-28).
- TEE attestation registry implemented: full CRUD, admin controls, event integration, and robust validation for TEE attestations (2025-07-28).
- NEAR contract integrates TEE attestation and event emission throughout order lifecycle (2025-07-28).
- Event.rs module enhanced: new event types, improved integration for order lifecycle and TEE attestation (2025-07-28).
- Event.rs module now supports all new TEE attestation events (2025-07-28).
- TEE module organization improved: all TEE components re-exported from `tee/mod.rs` (2025-07-28).
- Integrate or update NEAR escrow contract in `near-contracts/escrow` with TEE registry and order validation logic (2025-07-28).
- The Ethereum-side foundation is the provided contracts: `Resolver.sol` and `TestEscrowFactory.sol` (in `contracts/src`). These manage escrow deployment, order fulfillment, and interaction with the 1inch Fusion+ protocol. Extensions for NEAR compatibility will build on these.
- All Solidity contract files updated to version 0.8.23 for consistency and to resolve deployment errors.
- Note: Do not use hardhat for this project, instead use foundry
- Foundry: Use for Solidity/EVM development, testing, deployment (see https://getfoundry.sh for install and docs)
- Follow Foundry best practices: use named imports (e.g., import {MyContract} from "src/MyContract.sol"), avoid importing full files except for forge-std/Test or Script, and prefer absolute paths for clarity and maintainability (see https://getfoundry.sh/guides/best-practices/writing-contracts).
- OpenZeppelin: Use for secure contract libraries and standards (see https://docs.openzeppelin.com/)
- Reference OpenZeppelin secure contract development guides for access control, tokens, and utilities (see https://docs.openzeppelin.com/contracts/5.x/).
- Hackathon implementation constraints: No production API access, local-only testing, must use provided contracts, and implement a local relayer for cross-chain communication.
- OpenZeppelin Ownable (v4.9.5): constructor does NOT accept an owner parameter, always sets deployer as initial owner. FeeBank.sol error is due to passing an argument to Ownable(owner).
- Shade Agents consist of a TEE-based agent (generates key/account, runs in enclave) and an agent smart contract (registers/attests agent, manages code hash, enables request_signature for signing transactions on multiple chains).
- Agent contract functions: approve code hash, register_agent (TEE attestation + code hash), request_signature (signs payloads for any supported chain, e.g. EVM/NEAR, using chain signatures and derivation path).
- Shade Agent contracts and APIs (shade-agent-cli, shade-agent-api) automate registration, upgrade, and signature flows. Agents are stateless; accounts are persistent across TEE restarts.
- 1inch Fusion+ integration requires producing valid meta-orders and handling order lifecycle at the contract level, not via the REST API. Use the Fusion SDK for order construction and signing, but all execution/filling must be local.
- Comprehensive testing and bug fixing of all smart contracts before proceeding to meta-order integration.
- Ensure all required dependencies (OpenZeppelin, forge-std, cross-chain-swap) are installed and remappings are correct before running contract tests. Resolve any missing library or configuration issues as part of the testing phase.
- Solidity version in Foundry config updated to 0.8.23 to match cross-chain-swap contract requirements and resolve compilation errors (2025-07-29).
- Removed duplicate function declarations for name() and version() in TokenAdapter.sol to resolve identifier errors and follow Solidity best practices (2025-07-29).
- Fixed import paths in TestEscrowFactory.sol to use correct @openzeppelin and @1inch/cross-chain-swap paths; next step: rerun tests to verify all contracts compile and pass (2025-07-29).
- Solidity version mismatches detected across multiple contract and script files; update all Solidity source files to use pragma solidity 0.8.23 for consistency with project configuration and dependencies (2025-07-29).
- All Solidity contract and script files updated to pragma solidity 0.8.23 using a batch script for full project consistency (2025-07-29).
- Migrate all deploy scripts from Solidity/Foundry to TypeScript as requested by user (2025-07-29).
- All TypeScript deployment scripts must use Foundry (not Hardhat) for compilation, deployment, and scripting—leverage Foundry scripting APIs and ethers integration, not Hardhat (2025-07-29).
- TypeScript deployment script for NearBridge contract and config utilities created; uses Foundry and ethers.js, not Hardhat (2025-07-29).
- Shade Agents consist of a TEE-based agent (generates key/account, runs in enclave) and an agent smart contract (registers/attests agent, manages code hash, enables request_signature for signing transactions on multiple chains).
- Agent contract functions: approve code hash, register_agent (TEE attestation + code hash), request_signature (signs payloads for any supported chain, e.g. EVM/NEAR, using chain signatures and derivation path).
- Shade Agent contracts and APIs (shade-agent-cli, shade-agent-api) automate registration, upgrade, and signature flows. Agents are stateless; accounts are persistent across TEE restarts.
- 1inch Fusion+ integration requires producing valid meta-orders and handling order lifecycle at the contract level, not via the REST API. Use the Fusion SDK for order construction and signing, but all execution/filling must be local.
- Comprehensive testing and bug fixing of all smart contracts before proceeding to meta-order integration.
- Ensure all required dependencies (OpenZeppelin, forge-std, cross-chain-swap) are installed and remappings are correct before running contract tests. Resolve any missing library or configuration issues as part of the testing phase.

## Task List
### Phase 1: Research & Design
- [x] System architecture design (diagram, data flow, components)
- [x] Protocol integration design (message formats, hashlock/timelock, error handling)
- [x] Security design (threat modeling, TEE, key management for Chain Signatures)

### Phase 2: NEAR Side Implementation
- [x] Set up Shade Agent project (TEE env, build pipeline)
  - [x] Verify TEE environment is properly configured
  - [x] Confirm build pipeline is working
- [x] Deploy and register Shade Agent contract (approve code hash, TEE attestation, registration)
  - [x] Verify contract is deployed to testnet
  - [x] Confirm code hash approval
  - [x] Validate TEE attestation
- [x] Implement core agent logic (event listening, order processing, state management)
  - [x] Review event listening implementation
  - [x] Verify order processing logic
  - [x] Check state management
- [x] NEAR smart contracts: escrow (custody, hashlock, timelock), bridge (message verification, asset locking)
  - [x] Review escrow contract (custody, hashlock, timelock)
  - [x] Verify bridge contract (message verification, asset locking)
  - [x] Comprehensive input validation
  - [x] Event emission system
  - [x] TEE attestation verification
  - [x] Order model module (creation, validation, lifecycle)
- [x] Integrate Chain Signatures (signing logic, TEE key mgmt, tx construction)
  - [x] Verify signing logic
  - [x] Check TEE key management
  - [x] Test transaction construction

### Phase 3: Ethereum Side Implementation
- [x] Extend Resolver contract, local order management (validation, cross-chain verification)
- [x] Local event monitoring (order creation, fulfillment tracking)
- [x] Dedicated bridge contract (custody, message verification, dispute resolution)
- [x] Adapter contracts (token standards, fee handling)

### Phase 4: Cross-Chain Communication
- [x] Implement local relayer (message queue, retry, signature verification, nonce mgmt)
- [x] State synchronization (state sync, chain reorgs, finality checks)

### Phase 5: 1inch Fusion+ Meta-Order Integration
- [ ] Construct valid 1inch Fusion+ meta-orders using Fusion SDK (local, not REST API)
- [ ] Integrate NEAR Chain Signatures for meta-order signing
- [ ] Implement local order lifecycle management (matching, filling, cancellation, error handling)

### Phase 6: Testing & Security
- [x] Unit tests (contracts, agent logic, integration)
- [x] Security audits (code review, formal verification, pen testing)
- [x] Local network testing (forked networks, e2e, load, dry run testnet)
- [ ] Comprehensive contract logic tests and bug fixes

### Phase 7: Testnet Deployment
- [ ] Deploy NEAR bridge contract to Sepolia using deploy-near-bridge.ts in a clean environment (minimal build, no unrelated contracts)
- [ ] Fund test wallets, configure cross-chain comms
- [ ] On-chain demo prep: test scenarios (ETH->NEAR, NEAR->ETH), verification scripts, explorer links
- [ ] Migrate deployment scripts to TypeScript
  - [x] Create and run TypeScript deployment script for NearBridge
  - [x] Create and run TypeScript deployment script for Escrow contract
  - [x] Create TypeScript config utilities and NearBridge deploy script using Foundry/ethers.js
  - [x] Create README documentation for deployment scripts
  - [ ] Test all contracts on Ethereum Sepolia testnet
    - [ ] Deploy NearBridge contract to Sepolia using deploy-near-bridge.ts
    - [ ] Deploy Escrow contract to Sepolia using deploy-escrow.ts
    - [ ] Verify deployments and run basic interaction tests
    - [ ] Document Sepolia deployment results and issues
  - [ ] Migrate all remaining deploy scripts from Solidity/Foundry to TypeScript using Foundry, not Hardhat

### Phase 8: Demo & Documentation
- [ ] Live demo prep (script, verification steps, backup recording)
- [ ] Documentation (architecture, API, user guides, deployment)

### Phase 9: Stretch Goals
- [ ] UI development (swap interface, tx monitoring, history)
- [ ] Partial fills (order splitting, partial fulfillment, refund logic)
- [ ] Relayer enhancement (reliability, logging, monitoring, alerting)
- [x] Enhance TEE module with validation and error handling
- [x] Implement TEE attestation registry and lifecycle management
  - [x] Implement TEE registry module (CRUD, admin, events)
  - [x] Reorganize TEE module for exports
  - [x] Integrate TEE registry with Shade Agent contract
  - [x] Implement TEE attestation verification in order processing flow
  - [x] Add comprehensive tests for TEE-related functionality

## Current Goal
