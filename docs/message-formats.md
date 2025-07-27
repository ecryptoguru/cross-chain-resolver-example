# Cross-Chain Message Formats

This document defines the message formats used for communication between Ethereum, NEAR, and the relayer in the 1inch Fusion+ x NEAR cross-chain swap solution.

## Table of Contents

1. [Meta-Order Format](#meta-order-format)
2. [Ethereum to NEAR Messages](#ethereum-to-near-messages)
   - [Escrow Creation](#escrow-creation)
   - [Escrow Fulfillment](#escrow-fulfillment)
   - [Escrow Refund](#escrow-refund)
3. [NEAR to Ethereum Messages](#near-to-ethereum-messages)
   - [Deposit Notification](#deposit-notification)
   - [Withdrawal Request](#withdrawal-request)
4. [Hashlock and Timelock](#hashlock-and-timelock)
5. [Error Handling](#error-handling)

## Meta-Order Format

The meta-order format is used to represent cross-chain swap orders in a standardized way:

```typescript
interface MetaOrder {
  // Order identification
  id: string;                    // Unique order ID (UUID v4)
  status: 'pending' | 'filled' | 'cancelled' | 'expired';
  
  // Source chain details
  sourceChain: 'ethereum' | 'near';
  sourceToken: string;           // Token address on source chain
  sourceAmount: string;          // Amount in smallest unit (wei/yoctoNEAR)
  sourceAddress: string;         // Sender's address on source chain
  
  // Destination chain details
  destChain: 'ethereum' | 'near';
  destToken: string;             // Token address on destination chain
  destAmount: string;            // Minimum expected amount on destination
  destAddress: string;           // Recipient's address on destination chain
  
  // Security parameters
  hashlock: string;              // Hash of the secret (if applicable)
  timelock: number;              // Expiration timestamp (seconds since epoch)
  
  // Metadata
  createdAt: number;             // Creation timestamp (seconds since epoch)
  updatedAt: number;             // Last update timestamp
  
  // Signatures and proofs
  signatures: {
    source?: string;             // Signature from source chain
    relayer?: string;            // Relayer's attestation
  };
}
```

## Ethereum to NEAR Messages

### Escrow Creation

When creating an escrow on Ethereum that should trigger a swap on NEAR:

```typescript
interface EthereumToNearEscrowMessage {
  type: 'ESCROW_CREATED';
  orderId: string;               // Unique order ID
  escrowId: string;              // Ethereum escrow contract address
  token: string;                 // Token address on Ethereum
  amount: string;                // Amount in wei
  recipient: string;             // NEAR account ID
  hashlock: string;              // Hash of the secret
  timelock: number;              // Expiration timestamp
  
  // Additional metadata
  txHash: string;                // Ethereum transaction hash
  blockNumber: number;           // Block number
  logIndex: number;              // Log index in the block
}
```

### Escrow Fulfillment

When an escrow is fulfilled on Ethereum, notifying NEAR:

```typescript
interface EthereumFulfillmentMessage {
  type: 'ESCROW_FULFILLED';
  orderId: string;               // Original order ID
  escrowId: string;              // Ethereum escrow contract address
  secret: string;                // The secret that unlocks the hashlock
  amount: string;                // Actual amount fulfilled
  
  // Additional metadata
  txHash: string;                // Ethereum transaction hash
  blockNumber: number;           // Block number
}
```

### Escrow Refund

When an escrow is refunded on Ethereum:

```typescript
interface EthereumRefundMessage {
  type: 'ESCROW_REFUNDED';
  orderId: string;               // Original order ID
  escrowId: string;              // Ethereum escrow contract address
  reason?: string;               // Optional refund reason
  
  // Additional metadata
  txHash: string;                // Ethereum transaction hash
  blockNumber: number;           // Block number
}
```

## NEAR to Ethereum Messages

### Deposit Notification

When a deposit is made on NEAR that should trigger a swap on Ethereum:

```typescript
interface NearToEthereumDepositMessage {
  type: 'DEPOSIT_RECEIVED';
  orderId: string;               // Unique order ID
  depositId: string;             // NEAR receipt ID
  token: string;                 // NEAR token account ID
  amount: string;                // Amount in yoctoNEAR
  recipient: string;             // Ethereum address
  hashlock: string;              // Hash of the secret
  timelock: number;              // Expiration timestamp
  
  // Additional metadata
  receiptId: string;             // NEAR receipt ID
  blockHeight: number;           // NEAR block height
}
```

### Withdrawal Request

When a withdrawal is requested from NEAR to Ethereum:

```typescript
interface NearWithdrawalMessage {
  type: 'WITHDRAWAL_REQUESTED';
  orderId: string;               // Original order ID
  depositId: string;             // Original deposit ID
  amount: string;                // Amount to withdraw
  recipient: string;             // Ethereum address
  
  // Additional metadata
  receiptId: string;             // NEAR receipt ID
  blockHeight: number;           // NEAR block height
}
```

## Hashlock and Timelock

### Hashlock Generation

1. **Secret Generation**:
   - Generate a cryptographically secure random 32-byte secret
   - Example in JavaScript: `const secret = ethers.utils.randomBytes(32);`

2. **Hashlock Calculation**:
   - Hash the secret using keccak256
   - Example: `const hashlock = ethers.utils.keccak256(secret);`

### Timelock Implementation

- Timelocks are represented as Unix timestamps (seconds since epoch)
- Should account for block confirmation times on both chains
- Recommended minimum: 1 hour for testnet, 24 hours for mainnet

## Error Handling

### Error Message Format

```typescript
interface ErrorMessage {
  type: 'ERROR';
  code: string;                  // Error code (e.g., INSUFFICIENT_FUNDS)
  message: string;               // Human-readable error message
  details?: any;                 // Additional error details
  originalMessage?: any;         // The original message that caused the error
}
```

### Common Error Codes

- `INSUFFICIENT_FUNDS`: Not enough tokens for the swap
- `INVALID_SIGNATURE`: Message signature verification failed
- `EXPIRED_ORDER`: Order has expired
- `INVALID_HASHLOCK`: Invalid hashlock provided
- `DUPLICATE_ORDER`: Order with this ID already exists
- `CHAIN_UNAVAILABLE`: Target chain is currently unavailable
- `RELAYER_ERROR`: Internal relayer error
