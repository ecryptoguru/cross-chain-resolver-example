import { ChainSignatureService, createChainSignatureService } from '../services/chainSignatureService';
import { keyStores } from 'near-api-js';
import { TextEncoder } from 'util';
import { logger } from '../utils/logger';

// Mock the logger to prevent console output during tests
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe('ChainSignatureService', () => {
  // Test account ID (doesn't need to be a real account for testing)
  const TEST_ACCOUNT_ID = 'test-account.testnet';
  const TEST_NETWORK_ID = 'testnet';
  const TEST_NODE_URL = 'https://rpc.testnet.near.org';
  
  let service: ChainSignatureService;
  let keyStore: keyStores.KeyStore;

  beforeAll(() => {
    // Set up TextEncoder for tests
    global.TextEncoder = TextEncoder as any;
  });

  beforeEach(async () => {
    // Create a new in-memory key store for each test
    keyStore = new keyStores.InMemoryKeyStore();
    
    // Create a new service instance for each test
    service = await createChainSignatureService({
      accountId: TEST_ACCOUNT_ID,
      networkId: TEST_NETWORK_ID,
      nodeUrl: TEST_NODE_URL,
      keyStore,
    });
  });

  afterEach(() => {
    // Clear all mocks after each test
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with a new key pair', async () => {
      expect(service).toBeDefined();
      
      // The service should have generated a key pair
      const publicKey = service.getPublicKey();
      expect(publicKey).toBeDefined();
      expect(publicKey.startsWith('ed25519:')).toBe(true);
      
      // The key should be stored in the key store
      const storedKey = await keyStore.getKey(TEST_NETWORK_ID, TEST_ACCOUNT_ID);
      expect(storedKey).toBeDefined();
      expect(storedKey.getPublicKey().toString()).toEqual(publicKey);
    });

    it('should reuse an existing key pair if available', async () => {
      // Create a service with an existing key pair
      const existingService = await createChainSignatureService({
        accountId: TEST_ACCOUNT_ID,
        networkId: TEST_NETWORK_ID,
        nodeUrl: TEST_NODE_URL,
        keyStore,
      });
      
      const publicKey1 = existingService.getPublicKey();
      
      // Create another service with the same key store
      const newService = await createChainSignatureService({
        accountId: TEST_ACCOUNT_ID,
        networkId: TEST_NETWORK_ID,
        nodeUrl: TEST_NODE_URL,
        keyStore,
      });
      
      // It should use the existing key pair
      const publicKey2 = newService.getPublicKey();
      expect(publicKey2).toEqual(publicKey1);
    });
  });

  describe('message signing and verification', () => {
    const TEST_MESSAGE = 'test message';
    
    it('should sign and verify a message', async () => {
      // Sign a message
      const signature = await service.signMessage(TEST_MESSAGE);
      expect(signature).toBeDefined();
      
      // Get the public key
      const publicKey = service.getPublicKey();
      
      // Verify the signature
      const isValid = await service.verifySignature(TEST_MESSAGE, signature, publicKey);
      expect(isValid).toBe(true);
    });
    
    it('should detect invalid signatures', async () => {
      // Sign a message
      const signature = await service.signMessage(TEST_MESSAGE);
      
      // Get the public key
      const publicKey = service.getPublicKey();
      
      // Verify with a different message (should be invalid)
      const isValid = await service.verifySignature('different message', signature, publicKey);
      expect(isValid).toBe(false);
    });
    
    it('should sign and verify cross-chain messages', async () => {
      const message = {
        type: 'swap',
        from: 'sender.testnet',
        to: 'receiver.testnet',
        amount: '1000000000000000000', // 1 NEAR in yoctoNEAR
        token: 'wrap.testnet',
        nonce: Date.now(),
      };
      
      // Sign the message
      const signedMessage = await service.signCrossChainMessage(message);
      
      // The message should now have a signature
      expect(signedMessage.signature).toBeDefined();
      
      // Get the public key
      const publicKey = service.getPublicKey();
      
      // Verify the signature
      const isValid = await service.verifyCrossChainMessage(signedMessage, publicKey);
      expect(isValid).toBe(true);
    });
    
    it('should detect invalid cross-chain message signatures', async () => {
      const message = {
        type: 'swap',
        from: 'sender.testnet',
        to: 'receiver.testnet',
        amount: '1000000000000000000', // 1 NEAR in yoctoNEAR
        token: 'wrap.testnet',
        nonce: Date.now(),
      };
      
      // Sign the message
      const signedMessage = await service.signCrossChainMessage(message);
      
      // Tamper with the message
      const tamperedMessage = { ...signedMessage, amount: '2000000000000000000' };
      
      // Get the public key
      const publicKey = service.getPublicKey();
      
      // Verify the tampered message (should be invalid)
      const isValid = await service.verifyCrossChainMessage(tamperedMessage, publicKey);
      expect(isValid).toBe(false);
    });
  });
});
