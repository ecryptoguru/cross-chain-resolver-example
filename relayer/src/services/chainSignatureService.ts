import { KeyPair, keyStores, connect, utils, transactions } from 'near-api-js';
import { KeyStore } from 'near-api-js/lib/key_stores';
import { PublicKey } from 'near-api-js/lib/utils';
import { KeyPairEd25519 } from 'near-api-js/lib/utils/key_pair';
import { logger } from '../utils/logger';
import { sleep } from '../utils/common';

/**
 * Service for handling NEAR Chain Signatures
 * This service provides secure transaction signing capabilities using NEAR's Chain Signatures
 */
export class ChainSignatureService {
  private keyStore: KeyStore;
  private keyPair: KeyPairEd25519 | null = null;
  private accountId: string;
  private networkId: string;
  private nodeUrl: string;
  private isInitialized = false;

  /**
   * Create a new ChainSignatureService instance
   * @param config Configuration for the service
   */
  constructor(config: {
    accountId: string;
    networkId: string;
    nodeUrl: string;
    keyStore?: KeyStore;
  }) {
    this.accountId = config.accountId;
    this.networkId = config.networkId;
    this.nodeUrl = config.nodeUrl;
    this.keyStore = config.keyStore || new keyStores.InMemoryKeyStore();
  }

  /**
   * Initialize the service
   * This should be called before any other methods
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Load or create key pair
      const keyPair = await this.getOrCreateKeyPair();
      this.keyPair = keyPair as KeyPairEd25519;
      
      // Store the key pair if it was just created
      if (!(await this.keyStore.getKey(this.networkId, this.accountId))) {
        await this.keyStore.setKey(this.networkId, this.accountId, this.keyPair);
      }

      this.isInitialized = true;
      logger.info('ChainSignatureService initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize ChainSignatureService:', error);
      throw error;
    }
  }

  /**
   * Get or create a key pair for the account
   * @private
   */
  private async getOrCreateKeyPair(): Promise<KeyPair> {
    try {
      // Try to load existing key pair
      const existingKey = await this.keyStore.getKey(this.networkId, this.accountId);
      if (existingKey) {
        return existingKey;
      }

      // Generate a new key pair if none exists
      logger.info('No existing key found, generating new key pair');
      const keyPair = KeyPair.fromRandom('ed25519');
      return keyPair;
    } catch (error) {
      logger.error('Error getting or creating key pair:', error);
      throw error;
    }
  }

  /**
   * Sign a message using the account's private key
   * @param message Message to sign (as a string or Uint8Array)
   * @returns Signature as a base58-encoded string
   */
  public async signMessage(message: string | Uint8Array): Promise<string> {
    if (!this.isInitialized) {
      throw new Error('ChainSignatureService not initialized');
    }

    try {
      const messageBytes = typeof message === 'string' 
        ? new TextEncoder().encode(message) 
        : message;
      
      // Sign the message using the key pair
      const signature = this.keyPair!.sign(messageBytes);
      
      // Return the signature as a base58-encoded string
      return utils.serialize.base_encode(signature.signature);
    } catch (error) {
      logger.error('Error signing message:', error);
      throw error;
    }
  }

  /**
   * Verify a signature for a message
   * @param message Original message that was signed
   * @param signature Signature to verify (as a base58-encoded string)
   * @param publicKey Public key to verify against (as a base58-encoded string)
   * @returns boolean indicating if the signature is valid
   */
  public async verifySignature(
    message: string | Uint8Array,
    signature: string,
    publicKey: string
  ): Promise<boolean> {
    try {
      const messageBytes = typeof message === 'string' 
        ? new TextEncoder().encode(message) 
        : message;
      
      const publicKeyObj = PublicKey.fromString(publicKey);
      const signatureBytes = utils.serialize.base_decode(signature);
      
      return publicKeyObj.verify(messageBytes, signatureBytes);
    } catch (error) {
      logger.error('Error verifying signature:', error);
      return false;
    }
  }

  /**
   * Sign a NEAR transaction
   * @param transaction Transaction to sign
   * @returns Signed transaction
   */
  public async signTransaction(transaction: any): Promise<Uint8Array> {
    if (!this.isInitialized) {
      throw new Error('ChainSignatureService not initialized');
    }

    try {
      // Connect to the NEAR network
      const near = await connect({
        networkId: this.networkId,
        nodeUrl: this.nodeUrl,
        keyStore: this.keyStore,
        headers: {}
      });

      // Get the account
      const account = await near.account(this.accountId);
      
      // Get the access key for the account
      const accessKey = await account.findAccessKey();
      
      // Sign the transaction
      const signedTx = await account.signTransaction({
        ...transaction,
        signerId: this.accountId,
        nonce: accessKey.nonce + 1,
        blockHash: utils.serialize.base_decode(transaction.blockHash)
      });

      return signedTx[1];
    } catch (error) {
      logger.error('Error signing transaction:', error);
      throw error;
    }
  }

  /**
   * Sign a cross-chain message
   * @param message Message to sign
   * @returns Signed message with signature
   */
  public async signCrossChainMessage<T extends { signature?: string }>(message: T): Promise<T & { signature: string }> {
    try {
      // Convert the message to a string for signing
      const messageStr = JSON.stringify(message, Object.keys(message).sort());
      
      // Sign the message
      const signature = await this.signMessage(messageStr);
      
      // Return the message with the signature
      return { ...message, signature };
    } catch (error) {
      logger.error('Error signing cross-chain message:', error);
      throw error;
    }
  }

  /**
   * Verify a cross-chain message signature
   * @param message Message to verify
   * @param publicKey Public key to verify against (as a base58-encoded string)
   * @returns boolean indicating if the signature is valid
   */
  public async verifyCrossChainMessage<T extends { signature: string }>(
    message: T,
    publicKey: string
  ): Promise<boolean> {
    try {
      // Create a copy of the message without the signature
      const { signature, ...messageWithoutSignature } = message as any;
      
      // Convert the message to a string for verification
      const messageStr = JSON.stringify(messageWithoutSignature, Object.keys(messageWithoutSignature).sort());
      
      // Verify the signature
      return this.verifySignature(messageStr, signature, publicKey);
    } catch (error) {
      logger.error('Error verifying cross-chain message:', error);
      return false;
    }
  }

  /**
   * Get the public key for the account
   * @returns Public key as a base58-encoded string
   */
  public getPublicKey(): string {
    if (!this.isInitialized || !this.keyPair) {
      throw new Error('ChainSignatureService not initialized');
    }
    return this.keyPair.getPublicKey().toString();
  }
}

/**
 * Factory function to create and initialize a ChainSignatureService instance
 * @param config Configuration for the service
 * @returns Initialized ChainSignatureService instance
 */
export async function createChainSignatureService(
  config: {
    accountId: string;
    networkId?: string;
    nodeUrl?: string;
    keyStore?: KeyStore;
  }
): Promise<ChainSignatureService> {
  const service = new ChainSignatureService({
    accountId: config.accountId,
    networkId: config.networkId || 'testnet', // Default to testnet
    nodeUrl: config.nodeUrl || 'https://rpc.testnet.near.org', // Default testnet RPC
    keyStore: config.keyStore
  });
  
  await service.initialize();
  return service;
}
