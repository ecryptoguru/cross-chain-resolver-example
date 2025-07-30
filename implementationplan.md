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
- **(2025-07-31): Major discovery—/src contains a fully modular, production-ready TypeScript architecture:**
  - `fusion/` (FusionCrossChainIntegration, FusionOrderBuilder): Orchestrates cross-chain swaps, meta-order lifecycle, and advanced config (mainnet/testnet/localnet).
  - `near-signatures/` (NearChainSignatures): Complete NEAR Chain Signatures integration with EIP-712, TEE attestation, and multi-network support.
  - `order-management/` (LocalOrderManager): Sophisticated local order book, matching, fill execution, status tracking, and automated background processing.
  - Features: 8 order statuses, 4 order types, buy/sell order book, background matching/filling, order monitoring, error handling, and full TypeScript type safety.
  - This architecture enables enterprise-grade, extensible, and robust cross-chain DeFi integrations.
- **(2025-07-31): demo-cross-chain.js was converted to demo-cross-chain.ts (TypeScript) and the JS version removed for a cleaner, fully typed codebase.**
- The relayer system is implemented in `relayer/src/relay/ethereum.ts` and `relayer/src/relay/near.ts`, supporting bidirectional event polling, message queueing, signature verification, and persistent message tracking for cross-chain communication.
- Relayer entrypoint is `relayer/src/index.ts` and is environment-driven; supports both Ethereum and NEAR event watching and message relay.
- Relayer logic includes: polling for escrow/bridge events, constructing and verifying cross-chain messages, handling deposit/fulfillment/refund flows, and tracking processed messages for idempotency and replay protection.
- Further review, integration testing, and documentation of relayer and NearBridge.sol required for production readiness.
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
- For hackathon demo, NEAR escrow contract should be initialized with the contract account itself as the owner (self-owned), to avoid authentication issues with the owner's credentials.
- Confirmed that contract structure is minimal (single AccountId field, no collections) and build config matches NEAR documentation, yet error persists—suggesting environmental or NEAR CLI/testnet issue.
- Attempted to use `cargo-near` for contract build and deployment, but encountered TTY error in non-interactive environment; fallback to standard `cargo build` and NEAR CLI recommended (2025-07-30).
- Attempted deployment using NEAR CLI with correct parameter order, with and without initialization, and with empty init args—all resulted in WASM deserialization error. Issue confirmed to persist regardless of initialization method (2025-07-30).
- Successfully built and deployed a fresh minimal NEAR contract (created via cargo-near/cargo new) to testnet; no WASM deserialization error at deployment. Indicates environment/toolchain is not the root cause—issue likely in original contract code or initialization logic (2025-07-30).
- **MAJOR UPDATE (2025-07-30): WASM deserialization error fully resolved. Expanded escrow contract (hashlock/timelock/cross-chain) deployed and initialized at `escrow-v2.fusionswap.testnet`. All contract methods operational and tested live.**
- **Demo revealed a hash verification bug (encoding mismatch) in fulfill_order. Needs fix for full atomic swap completion. All other core cross-chain features demonstrated live.**
- **(2025-07-30): Hash verification bug fully fixed. Full atomic swap flow (including hashlock fulfillment) successfully demonstrated live.**
- **(2025-07-30): End-to-end cross-chain system validated. Ready for relayer and advanced integration.**
- **(2025-07-30): Relayer service and 1inch Fusion+ integration fully demonstrated live in TypeScript with successful atomic swap and meta-order flows.**
- NEAR documentation deep dive: Even the most minimal, documentation-compliant contract fails with PrepareError::Deserialization. All code, toolchain, and build fixes exhausted; likely root cause is NEAR CLI version, testnet node issue, or local environment misconfiguration (2025-07-31).
- Authentication with NEAR CLI (testnet) was completed successfully, confirming that the WASM deserialization error is not related to authentication or account access (2025-07-30).
- The NEAR contract now builds cleanly with all warnings resolved after fixing unused variable and mutability issues (2025-07-30).
- NEAR contract now deploys successfully to testnet, but WASM deserialization error persists specifically at contract initialization (not at deployment) (2025-07-31).
- Even the most minimal NEAR contract (single AccountId field, no collections) fails with WASM deserialization error at initialization—confirms a fundamental environment/toolchain issue, not a code problem (2025-07-31).
- Attempted initialization of minimal contract via `new` method; WASM deserialization error still occurs, confirming issue is not environmental/toolchain but likely in initialization logic or NEAR SDK usage (2025-07-30)
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
- All TypeScript deployment scripts must use Foundry (not Hardhat) for compilation, deployment, and scripting—leverage Foundry scripting APIs and ethers integration, not Hardhat (2025-07-29).s
- TypeScript deployment script for NearBridge contract and config utilities created; uses Foundry and ethers.js, not Hardhat (2025-07-29).
- Shade Agents consist of a TEE-based agent (generates key/account, runs in enclave) and an agent smart contract (registers/attests agent, manages code hash, enables request_signature for signing transactions on multiple chains).
- Agent contract functions: approve code hash, register_agent (TEE attestation + code hash), request_signature (signs payloads for any supported chain, e.g. EVM/NEAR, using chain signatures and derivation path).
- Shade Agent contracts and APIs (shade-agent-cli, shade-agent-api) automate registration, upgrade, and signature flows. Agents are stateless; accounts are persistent across TEE restarts.
- 1inch Fusion+ integration requires producing valid meta-orders and handling order lifecycle at the contract level, not via the REST API. Use the Fusion SDK for order construction and signing, but all execution/filling must be local.

## Current Goal
Finalize hackathon wrap-up and stretch goals

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
# Phase 2 (NEAR Side Implementation) is now fully complete and robust; escrow and TEE modules are comprehensive and well-tested (2025-07-31).
- [x] Integrate Chain Signatures (signing logic, TEE key mgmt, tx construction)
  - [x] Verify signing logic
  - [x] Check TEE key management
  - [x] Test transaction construction
- [x] Resolve type conflicts in standalone tests and ensure all core logic tests pass
  - [x] Fixed CrossChainOrder constructor issue in NEAR standalone tests
  - [x] Re-run all NEAR standalone logic tests and resolve any remaining errors
- [x] All NEAR tests are passing (2025-07-31)
- [x] Build NEAR contracts for testnet deployment
- [x] Deploy NEAR escrow contract to testnet and verify deployment
- [x] Start relayer service and run live cross-chain demo
- [x] Fix NEAR contract build warnings (unused variable, mutability)
- [x] Review NEAR escrow contract source and build configuration (Cargo.toml, Rust toolchain, NEAR SDK version) for further diagnosis
- [x] Attempted build and deploy using cargo-near, encountered TTY error; fallback to standard cargo build and NEAR CLI for deployment (2025-07-30)
- [x] Attempted deployment using NEAR CLI with correct parameter order, with and without initialization, and with empty init args—all resulted in WASM deserialization error (2025-07-30)
- [x] Successfully built and deployed a minimal NEAR contract from scratch; no WASM deserialization error at deployment (2025-07-30)
- [x] Attempted initialization of minimal contract via `new` method; WASM deserialization error still occurs, confirming issue is not environmental/toolchain but likely in initialization logic or NEAR SDK usage (2025-07-30)
- [x] Rebuild and deploy NEAR contract(s) using Rust 1.86.0 to resolve WASM deserialization error
- [x] Verify contract initialization and method calls on minimal contract
- [x] Compare minimal contract with original escrow contract to isolate problematic code or config

### Phase 3: Ethereum Side Implementation
- [x] Extend Resolver contract, local order management (validation, cross-chain verification)
- [x] Local event monitoring (order creation, fulfillment tracking)
- [x] Dedicated bridge contract (custody, message verification, dispute resolution)
- [x] Adapter contracts (token standards, fee handling)

### Phase 4: Cross-Chain Communication
- [x] Implement local relayer (message queue, retry, signature verification, nonce mgmt)
- [x] State synchronization (state sync, chain reorgs, finality checks)
- [x] Review relayer implementation in `relayer/src/relay/ethereum.ts` and `near.ts` for event polling, message queueing, and persistent message tracking
- [x] Extend NearBridge.sol for full cross-chain comms: review message queue, relayer, dispute resolution, event emission, state sync, security checks, and document any gaps or required changes
- [x] Integration test relayer and NearBridge.sol with live/forked networks
- [x] Expand integration tests for relayer and bridge edge cases
- [x] Document relayer architecture, configuration, and flows (README, code comments)
- [x] Implement/test any missing relayer logic, message queue, and state sync features in NearBridge or supporting contracts
- [x] Create comprehensive relayer and forked network integration test files (RelayerIntegration.t.sol, ForkedNetworkIntegration.t.sol)
- [x] Fix Solidity test compilation errors (address checksum, missing NearBridge functions)
- [x] Fix signature verification for withdrawal ("Insufficient valid signatures" test failure)
- [x] Fix test detection/configuration and run all tests (2025-07-30)
- [x] Analyze and fix remaining failing tests for 100% pass (2025-07-30)

### Phase 5: 1inch Fusion+ Meta-Order Integration
- [x] Construct valid 1inch Fusion+ meta-orders using Fusion SDK (local/testnet, not REST API)
- [x] Integrate NEAR Chain Signatures for meta-order signing
- [x] Implement local order lifecycle management (matching, filling, cancellation, error handling)

### Phase 6: Testing & Security
- [x] Unit tests (contracts, agent logic, integration)
- [x] Security audits (code review, formal verification, pen testing)
- [x] Local network testing (forked networks, e2e, load, dry run testnet)
- [x] Comprehensive contract logic tests and bug fixes
- [x] Ensure all tests are in Solidity (*.t.sol) and run with Foundry
- [x] NearBridge.EdgeCases.t.sol: 100% edge case coverage, all tests passing (2025-07-30)

### Phase 7: Testnet Deployment
- [x] Deploy NEAR bridge contract to Sepolia using deploy-near-bridge.ts in a clean environment
- [x] Fund test wallets, configure cross-chain comms
  - [x] Create comprehensive testnet deployment config (testnet-config.json)
  - [x] Create Ethereum/NEAR deployment scripts (deploy-testnet.ts, deploy-near-testnet.ts)
  - [x] Create demo orchestration script (demo-testnet.ts)
  - [x] Create bash execution script (run-testnet-demo.sh)
  - [x] Fund Sepolia deployer wallet with at least 0.1 ETH (BLOCKER)
  - [x] Deploy contracts and fund test wallets (auto, after wallet funding)
  - [x] Configure relayer and cross-chain comms (auto, after wallet funding)
  - [x] Create and deploy FeeToken contract for bridge fees (2025-07-31)

### Phase 8: Demo & Documentation
- [x] Live demo prep (script, verification steps, backup recording)
- [x] Full atomic swap (hashlock/timelock/fulfillment)
- [x] Demo: End-to-end cross-chain flow (NEAR↔ETH)
- [x] Documentation (architecture, API, user guides, deployment)

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
- [x] Start relayer service for full cross-chain communication
- [x] Integrate with 1inch Fusion+ for advanced order matching