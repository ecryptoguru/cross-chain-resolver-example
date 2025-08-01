import { jest } from '@jest/globals';
import { ChainSignatureService } from '../services/chainSignatureService.js';
import { UnencryptedFileSystemKeyStore } from '@near-js/keystores-node';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

// Mock the logger module using moduleNameMapper in Jest config
jest.mock('src/utils/logger');

// Mock the file system modules
jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue('mocked-key'),
  access: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn().mockReturnValue('mocked-key'),
}));

// Import mocks after setting them up
import * as fsPromises from 'fs/promises';
import * as fs from 'fs';

// Get typed mocks
const fsPromisesMocked = jest.mocked(fsPromises);
const fsMocked = jest.mocked(fs);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('ChainSignatureService', () => {
  // Test account ID (doesn't need to be a real account for testing)
  const TEST_ACCOUNT_ID = 'test-account.testnet';
  const TEST_NETWORK_ID = 'testnet';
  const TEST_NODE_URL = 'https://rpc.testnet.near.org';
  const TEST_KEY_DIR = join(homedir(), '.near-credentials');
  
  let service: ChainSignatureService;

  beforeAll(() => {
    // Set up TextEncoder for tests
    global.TextEncoder = TextEncoder as any;
  });

  beforeEach(async () => {
    // Create a new service instance for each test using the static create method
    service = await ChainSignatureService.create({
      accountId: TEST_ACCOUNT_ID,
      networkId: TEST_NETWORK_ID,
      nodeUrl: TEST_NODE_URL,
      keyStorePath: TEST_KEY_DIR,
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
      const publicKey = await service.getPublicKey();
      expect(publicKey).toBeDefined();
      expect(publicKey.startsWith('ed25519:')).toBe(true);
    });

    it('should reuse an existing key pair if available', async () => {
      // Get the public key from the first service
      const publicKey1 = await service.getPublicKey();
      
      // Create another service with the same key directory using the static create method
      const newService = await ChainSignatureService.create({
        accountId: TEST_ACCOUNT_ID,
        networkId: TEST_NETWORK_ID,
        nodeUrl: TEST_NODE_URL,
        keyStorePath: TEST_KEY_DIR,
      });
      
      // It should use the existing key pair
      const publicKey2 = await newService.getPublicKey();
      expect(publicKey2).toEqual(publicKey1);
    });
  });

  describe('message signing and verification', () => {
    const TEST_MESSAGE = 'test message';
    
    it('should sign and verify a message', async () => {
      // Get the public key first
      const publicKey = await service.getPublicKey();
      expect(publicKey).toBeDefined();
      expect(publicKey.startsWith('ed25519:')).toBe(true);
      
      // Sign a message
      const signature = await service.signMessage(TEST_MESSAGE);
      expect(signature).toBeDefined();
      expect(typeof signature).toBe('string');
      expect(signature.length).toBeGreaterThan(0);
      
      // Verify the signature with the public key
      const isValid = await service.verifySignature(TEST_MESSAGE, signature, publicKey);
      expect(isValid).toBe(true);
      
      // Also test without providing public key (should use the service's key pair)
      const isValidWithoutPublicKey = await service.verifySignature(TEST_MESSAGE, signature);
      expect(isValidWithoutPublicKey).toBe(true);
    });
    
    it('should detect invalid signatures', async () => {
      // Get the public key first
      const publicKey = await service.getPublicKey();
      
      // Sign a message
      const signature = await service.signMessage(TEST_MESSAGE);
      
      // Verify with a different message (should be invalid)
      const isValidDifferentMessage = await service.verifySignature('different message', signature, publicKey);
      expect(isValidDifferentMessage).toBe(false);
      
      // Verify with a different signature (should be invalid)
      const differentSignature = signature.split('').reverse().join('');
      const isValidDifferentSignature = await service.verifySignature(TEST_MESSAGE, differentSignature, publicKey);
      expect(isValidDifferentSignature).toBe(false);
      
      // Verify with a different public key (should be invalid)
      const differentPublicKey = publicKey.split('').reverse().join('');
      const isValidDifferentPublicKey = await service.verifySignature(TEST_MESSAGE, signature, differentPublicKey);
      expect(isValidDifferentPublicKey).toBe(false);
    });
    
    it('should sign and verify cross-chain messages', async () => {
      // Get the public key first
      const publicKey = await service.getPublicKey();
      
      const message = {
        type: 'swap',
        from: 'sender.testnet',
        to: 'receiver.testnet',
        amount: '1000000000000000000', // 1 NEAR in yoctoNEAR
        token: 'wrap.testnet',
        nonce: Date.now(),
      };
      
      // Convert message to string for signing
      const messageString = JSON.stringify(message);
      
      // Sign the message
      const signature = await service.signMessage(messageString);
      const signedMessage = { ...message, signature };
      
      // The message should now have a signature
      expect(signedMessage.signature).toBeDefined();
      expect(typeof signedMessage.signature).toBe('string');
      expect(signedMessage.signature.length).toBeGreaterThan(0);
      
      // Verify the signature by reconstructing the original message
      const { signature: messageSignature, ...messageData } = signedMessage;
      const messageDataString = JSON.stringify(messageData);
      
      // Verify with the public key
      const isValid = await service.verifySignature(
        messageDataString, 
        messageSignature, 
        publicKey
      );
      expect(isValid).toBe(true);
      
      // Also test without providing public key (should use the service's key pair)
      const isValidWithoutPublicKey = await service.verifySignature(
        messageDataString,
        messageSignature
      );
      expect(isValidWithoutPublicKey).toBe(true);
    });
    
    it('should detect invalid cross-chain message signatures', async () => {
      // Get the public key first
      const publicKey = await service.getPublicKey();
      
      const message = {
        type: 'swap',
        from: 'sender.testnet',
        to: 'receiver.testnet',
        amount: '1000000000000000000', // 1 NEAR in yoctoNEAR
        token: 'wrap.testnet',
        nonce: Date.now(),
      };
      
      // Convert message to string for signing
      const messageString = JSON.stringify(message);
      
      // Sign the message
      const signature = await service.signMessage(messageString);
      const signedMessage = { ...message, signature };
      
      // Tamper with the message
      const tamperedMessage = { ...signedMessage, amount: '2000000000000000000' };
      
      // Verify the tampered message (should be invalid)
      const { signature: tamperedSignature, ...tamperedData } = tamperedMessage;
      const tamperedDataString = JSON.stringify(tamperedData);
      
      // Test with tampered amount
      const isTamperedValid = await service.verifySignature(
        tamperedDataString, 
        tamperedSignature, 
        publicKey
      );
      expect(isTamperedValid).toBe(false);
      
      // Test with original message but wrong signature
      const wrongSignature = signature.split('').reverse().join('');
      const originalDataString = JSON.stringify(message);
      const isWrongSignatureValid = await service.verifySignature(
        originalDataString,
        wrongSignature,
        publicKey
      );
      expect(isWrongSignatureValid).toBe(false);
      
      // Test with wrong public key
      const wrongPublicKey = publicKey.split('').reverse().join('');
      const isWrongPublicKeyValid = await service.verifySignature(
        originalDataString,
        signature,
        wrongPublicKey
      );
      expect(isWrongPublicKeyValid).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle key file read errors', async () => {
      // Mock the file system to throw an error
      const mockError = new Error('Failed to read key file');
      
      // Setup mocks
      (fsPromisesMocked.access as jest.Mock).mockResolvedValue(undefined);
      (fsPromisesMocked.readFile as jest.Mock).mockRejectedValue(mockError);
      
      // Mock logger to capture errors
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      try {
        // This should not throw, but should log an error
        const result = await service.getPublicKey();
        expect(result).toBeUndefined();
        
        // Verify error was logged
        expect(errorSpy).toHaveBeenCalledWith(
          'Error reading key file:', 
          expect.objectContaining({ message: 'Failed to read key file' })
        );
      } finally {
        // Clean up
        errorSpy.mockRestore();
      }
    });
    
    it('should handle invalid public keys during verification', async () => {
      // Sign a message
      const signature = await service.signMessage('test');
      
      // Try to verify with an invalid public key
      const isValid = await service.verifySignature('test', signature, 'invalid-public-key');
      expect(isValid).toBe(false);
    });
  });

  describe('cross-chain message validation', () => {
    it('should validate message structure', async () => {
      // Invalid message missing required fields
      const invalidMessage = {
        from: 'sender.testnet',
        amount: '100'
      };
      
      // Should throw when trying to sign an invalid message
      await expect(service.signMessage(JSON.stringify(invalidMessage))).rejects.toBeDefined();
      
      // Valid message with all required fields
      const validMessage = {
        type: 'swap',
        from: 'sender.testnet',
        to: 'receiver.testnet',
        amount: '1000000000000000000',
        token: 'wrap.testnet',
        nonce: Date.now(),
      };
      
      // Should not throw for valid message
      await expect(service.signMessage(JSON.stringify(validMessage))).resolves.not.toThrow();
    });
    
    it('should detect invalid signatures', async () => {
      const message = {
        type: 'swap',
        from: 'sender.testnet',
        to: 'receiver.testnet',
        amount: '1000000000000000000',
        token: 'wrap.testnet',
        nonce: Date.now(),
        signature: 'invalid-signature'
      };
      
      // Should return false for invalid signature
      const publicKey = await service.getPublicKey();
      const messageToVerify = { ...message };
      const { signature: messageSignature, ...messageData } = messageToVerify;
      const isValid = await service.verifySignature(
        JSON.stringify(messageData), 
        messageSignature, 
        publicKey
      );
      expect(isValid).toBe(false);
    });
  });
});
