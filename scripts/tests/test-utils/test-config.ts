// Test configuration utilities for enhanced scripts testing

export const TEST_CONFIG = {
  // Ethereum test configuration
  ethereum: {
    rpcUrl: 'https://eth-sepolia.g.alchemy.com/v2/test',
    privateKey: '0x' + '0'.repeat(64),
    bridgeAddress: '0x' + '1'.repeat(40),
    chainId: 11155111,
    blockNumber: 1000000
  },

  // NEAR test configuration
  near: {
    nodeUrl: 'https://rpc.testnet.near.org',
    networkId: 'testnet',
    accountId: 'test.testnet',
    privateKey: 'ed25519:' + 'A'.repeat(88),
    escrowContractId: 'escrow.test.testnet'
  },

  // Transfer test configuration
  transfer: {
    amount: '0.01',
    recipient: '0x' + '2'.repeat(40),
    timelock: 3600,
    secret: 'test-secret-' + '0'.repeat(32),
    secretHash: '0x' + '3'.repeat(64)
  },

  // Monitor test configuration
  monitor: {
    pollInterval: 1000,
    maxReconnectAttempts: 3,
    healthCheckInterval: 5000,
    logLevel: 'error' // Reduce noise in tests
  }
};

export const INVALID_CONFIG = {
  ethereum: {
    rpcUrl: 'invalid-url',
    privateKey: 'invalid-key',
    bridgeAddress: 'invalid-address'
  },
  near: {
    nodeUrl: 'invalid-url',
    networkId: 'invalid-network',
    accountId: 'invalid-account',
    privateKey: 'invalid-key'
  }
};

export function createValidMonitorConfig() {
  return {
    ethereumRpcUrl: TEST_CONFIG.ethereum.rpcUrl,
    nearRpcUrl: TEST_CONFIG.near.nodeUrl,
    nearBridgeAddress: TEST_CONFIG.ethereum.bridgeAddress,
    nearEscrowContract: TEST_CONFIG.near.escrowContractId,
    pollInterval: TEST_CONFIG.monitor.pollInterval,
    maxReconnectAttempts: TEST_CONFIG.monitor.maxReconnectAttempts,
    healthCheckInterval: TEST_CONFIG.monitor.healthCheckInterval,
    logLevel: TEST_CONFIG.monitor.logLevel
  };
}

export function createValidTestConfig() {
  return {
    ethereumRpcUrl: TEST_CONFIG.ethereum.rpcUrl,
    privateKey: TEST_CONFIG.ethereum.privateKey,
    nearBridgeAddress: TEST_CONFIG.ethereum.bridgeAddress,
    transferAmount: TEST_CONFIG.transfer.amount,
    timelock: TEST_CONFIG.transfer.timelock,
    recipient: TEST_CONFIG.transfer.recipient,
    logLevel: TEST_CONFIG.monitor.logLevel
  };
}

export function createValidNearToEthConfig() {
  return {
    ethereumRpcUrl: TEST_CONFIG.ethereum.rpcUrl,
    ethereumPrivateKey: TEST_CONFIG.ethereum.privateKey,
    nearBridgeAddress: TEST_CONFIG.ethereum.bridgeAddress,
    nearNodeUrl: TEST_CONFIG.near.nodeUrl,
    nearNetworkId: TEST_CONFIG.near.networkId,
    nearAccountId: TEST_CONFIG.near.accountId,
    nearPrivateKey: TEST_CONFIG.near.privateKey,
    nearEscrowContractId: TEST_CONFIG.near.escrowContractId,
    ethRecipient: TEST_CONFIG.transfer.recipient,
    transferAmount: TEST_CONFIG.transfer.amount,
    timelock: TEST_CONFIG.transfer.timelock,
    logLevel: TEST_CONFIG.monitor.logLevel
  };
}
