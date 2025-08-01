// Import proper NEAR APIs from @near-js packages
import { Account, Connection } from '@near-js/accounts';
import { JsonRpcProvider, Provider } from '@near-js/providers';
import { KeyPairSigner } from '@near-js/signers';
import { UnencryptedFileSystemKeyStore } from '@near-js/keystores-node';
import { KeyPairEd25519, PublicKey, KeyType } from '@near-js/crypto';
import { homedir } from 'os';
import path from 'path';
import { logger } from '../utils/logger.js';
import { sleep } from '../utils/common.js';
import type { KeyStore as NearKeyStore } from '@near-js/keystores';
import type { KeyPair } from '@near-js/crypto';
import {
  RelayerError,
  ValidationError,
  SecurityError,
  NetworkError,
  ContractError,
  StorageError,
  ConfigurationError,
  ErrorHandler
} from '../utils/errors.js';

// Type definitions for better type safety
interface NearConnection {
  provider: JsonRpcProvider;
  signer: KeyPairSigner;
  account: Account;
}

// Constants
const DEFAULT_KEY_STORE_PATH = path.join(homedir(), '.near-credentials');
const NETWORK_ID = process.env.NEAR_NETWORK_ID || 'testnet';
const NODE_URL = process.env.NEAR_NODE_URL || 'https://rpc.testnet.near.org';

// Helper function to convert string to Uint8Array
function stringToUint8Array(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

// Helper function to convert Uint8Array to hex string
function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Service for handling NEAR Chain Signatures
 * This service provides secure transaction signing capabilities using NEAR's Chain Signatures
 */
export class ChainSignatureService {
  private keyStore: UnencryptedFileSystemKeyStore;
  private keyPair: KeyPairEd25519 | null = null;
  private accountId: string;
  private networkId: string;
  private nodeUrl: string;
  private connection: NearConnection | null = null;
  private isInitialized = false;
  private provider: JsonRpcProvider;

  /**
   * Create a new ChainSignatureService instance
   * @param accountId NEAR account ID to use for signing
   * @param keyStorePath Optional path to the key store directory
   * @param nodeUrl Optional custom NEAR RPC node URL
   */
  constructor(
    accountId: string, 
    keyStorePath: string = DEFAULT_KEY_STORE_PATH,
    nodeUrl: string = NODE_URL
  ) {
    this.accountId = accountId;
    this.networkId = NETWORK_ID;
    this.nodeUrl = nodeUrl;
    this.provider = new JsonRpcProvider({ url: nodeUrl });
    this.keyStore = new UnencryptedFileSystemKeyStore(keyStorePath);
  }

  /**
   * Initialize the service by loading the key pair and setting up the connection
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Load the key pair
      this.keyPair = await this.loadKeyPair();
      
      // Create a signer with the loaded key pair
      const signer = new KeyPairSigner(this.keyPair);
      
      // Create a new Account instance with the account ID, provider, and signer
      // Use type assertion to handle JsonRpcProvider to Provider compatibility
      const account = new Account(
        this.accountId,
        this.provider as unknown as Provider, // Type assertion to handle compatibility
        signer
      );
      
      // Set up the connection
      this.connection = {
        provider: this.provider,
        signer,
        account
      };

      this.isInitialized = true;
      logger.info('ChainSignatureService initialized successfully');
    } catch (error: unknown) {
      const errorMessage = `Failed to initialize ChainSignatureService: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(errorMessage, { error });
      throw new Error(errorMessage);
    }
  }

  /**
   * Load the key pair from the key store or create a new one if it doesn't exist
   * @returns The loaded or created key pair
   */
  private async loadKeyPair(): Promise<KeyPairEd25519> {
    try {
      // Try to load the key pair from the key store
      const keyData = await this.keyStore.getKey(this.networkId, this.accountId);
      
      if (keyData) {
        // The key store returns a KeyPair instance, so we can cast it directly
        return keyData as KeyPairEd25519;
      }

      // If no key pair exists, create a new one
      const newKeyPair = KeyPairEd25519.fromRandom();
      
      // Store the new key pair
      await this.keyStore.setKey(
        this.networkId, 
        this.accountId, 
        newKeyPair
      );
      
      return newKeyPair;
    } catch (error) {
      const errorMsg = `Failed to load or create key pair: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
  }

  /**
   * Sign a message with the account's private key
   * @param message The message to sign
   * @returns The signature as a hex string
   */
  public async signMessage(message: string): Promise<string> {
    if (!this.isInitialized) {
      throw new Error('ChainSignatureService not initialized');
    }

    try {
      if (!this.keyPair) {
        throw new Error('No key pair available for signing');
      }

      // Convert the message to bytes
      const messageBytes = stringToUint8Array(message);
      
      // Sign the message
      const signature = this.keyPair.sign(messageBytes);
      
      // Convert the signature to a hex string
      return uint8ArrayToHex(signature.signature);
    } catch (error) {
      const errorMsg = `Failed to sign message: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
  }

  /**
   * Verify a signature for a message
   * @param message The message that was signed
   * @param signature The signature to verify (as a hex string)
   * @param publicKey The public key to use for verification (optional, uses account's key if not provided)
   * @returns True if the signature is valid, false otherwise
   */
  public async verifySignature(
    message: string,
    signature: string,
    publicKey?: string
  ): Promise<boolean> {
    if (!this.isInitialized) {
      throw new Error('ChainSignatureService not initialized');
    }

    try {
      if (!this.keyPair && !publicKey) {
        throw new Error('No key pair available for verification and no public key provided');
      }

      // Convert the message to bytes
      const messageBytes = stringToUint8Array(message);
      
      // Convert the signature from hex to bytes
      const signatureBytes = new Uint8Array(
        signature.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
      );
      
      // Create a public key instance
      let pubKey: PublicKey;
      if (publicKey) {
        // If public key is provided, parse it (it might be in 'ed25519:...' format)
        const pubKeyStr = publicKey.startsWith('ed25519:') 
          ? publicKey.substring(8) // Remove 'ed25519:' prefix
          : publicKey;
        pubKey = PublicKey.fromString(pubKeyStr);
      } else if (this.keyPair) {
        // Use the key pair's public key if no public key is provided
        pubKey = this.keyPair.getPublicKey();
      } else {
        throw new Error('No public key available for verification');
      }
      
      // Verify the signature
      const isValid = pubKey.verify(messageBytes, signatureBytes);
      
      if (!isValid) {
        logger.warn('Signature verification failed', { 
          message: message,
          signature: signature,
          publicKey: pubKey.toString()
        });
      }
      
      return isValid;
    } catch (error) {
      const errorMsg = `Failed to verify signature: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(errorMsg, { error });
      return false;
    }
  }

  /**
   * Sign a transaction with the account's private key
   * @param txData The transaction data to sign
   * @returns Signed transaction signature
   */
  public async signTransaction(txData: {
    receiverId: string;
    actions: any[];
    blockHash: string;
  }): Promise<Uint8Array> {
    if (!this.isInitialized) {
      throw new Error('ChainSignatureService not initialized');
    }

    if (!this.connection) {
      throw new Error('No active connection');
    }

    if (!this.keyPair) {
      throw new Error('No key pair available for signing');
    }

    try {
      const { account } = this.connection;
      
      // Get the public key for the account
      const publicKey = this.keyPair.getPublicKey();
      
      // Get the access key for the account
      const accessKey = await account.getAccessKey(publicKey);
      
      if (!accessKey) {
        throw new Error(`No access key found for ${this.accountId}`);
      }

      // Convert nonce to number if it's a bigint
      const nonce = typeof accessKey.nonce === 'bigint' 
        ? accessKey.nonce + BigInt(1)
        : BigInt((accessKey.nonce as number) + 1);

      // Create a transaction hash to sign
      const transaction = {
        signerId: this.accountId,
        publicKey,
        nonce,
        receiverId: txData.receiverId,
        actions: txData.actions,
        blockHash: txData.blockHash
      };
      
      // Sign the transaction
      const message = new TextEncoder().encode(JSON.stringify(transaction));
      const signature = await this.keyPair.sign(message);
      
      // Return the signature bytes
      return signature.signature;
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

  /**
   * Create a new instance of the NEAR relayer
   * @param config Configuration for the relayer
   * @returns A new instance of the NEAR relayer
   */
  public static async create(config: {
    accountId: string;
    networkId?: string;
    nodeUrl?: string;
    keyStorePath?: string;
  }): Promise<ChainSignatureService> {
    const relayer = new ChainSignatureService(
      config.accountId,
      config.keyStorePath,
      config.nodeUrl
    );
    await relayer.initialize();
    return relayer;
  }
}
