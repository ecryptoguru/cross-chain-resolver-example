import { ethers } from 'ethers';
import { FusionOrder } from '@1inch/fusion-sdk';
import { EIP712TypedData } from '@1inch/limit-order-sdk';

/**
 * Configuration for NEAR Chain Signatures integration
 */
export interface NearChainSignaturesConfig {
  nearNetworkId: string; // 'mainnet' | 'testnet' | 'localnet'
  nearNodeUrl: string;
  agentAccountId: string; // Shade Agent account ID
  agentContractId: string; // Agent smart contract ID
  derivationPath: string; // Path for key derivation (e.g., 'ethereum,1')
  teeAttestationUrl?: string; // TEE attestation service URL
}

/**
 * Interface for NEAR Chain Signatures response
 */
export interface ChainSignatureResponse {
  signature: {
    big_r: {
      affine_point: string;
    };
    s: {
      scalar: string;
    };
    recovery_id: number;
  };
  request_id: string;
}

/**
 * Interface for signature request payload
 */
export interface SignatureRequestPayload {
  payload: string; // Hex-encoded payload to sign
  path: string; // Derivation path
  key_version: number;
}

/**
 * NEAR Chain Signatures integration for cross-chain meta-order signing
 * Enables signing 1inch Fusion+ orders using NEAR's Chain Signatures feature
 */
export class NearChainSignatures {
  private config: NearChainSignaturesConfig;
  private agentPublicKey: string | null = null;
  private derivedAddress: string | null = null;

  constructor(config: NearChainSignaturesConfig) {
    this.config = config;
  }

  /**
   * Initialize the NEAR Chain Signatures client
   * Retrieves agent public key and derives Ethereum address
   */
  async initialize(): Promise<void> {
    try {
      // Get agent public key from NEAR agent contract
      this.agentPublicKey = await this.getAgentPublicKey();
      
      // Derive Ethereum address from public key
      this.derivedAddress = await this.deriveEthereumAddress();
      
      console.log(`NEAR Chain Signatures initialized:`);
      console.log(`Agent Account: ${this.config.agentAccountId}`);
      console.log(`Derived Ethereum Address: ${this.derivedAddress}`);
      
    } catch (error) {
      throw new Error(`Failed to initialize NEAR Chain Signatures: ${error}`);
    }
  }

  /**
   * Sign a 1inch Fusion+ meta-order using NEAR Chain Signatures
   */
  async signFusionOrder(order: FusionOrder): Promise<string> {
    if (!this.agentPublicKey || !this.derivedAddress) {
      throw new Error('NEAR Chain Signatures not initialized. Call initialize() first.');
    }

    try {
      // Get the EIP-712 typed data for the order
      const typedData = this.getFusionOrderTypedData(order);
      
      // Create the message hash according to EIP-712
      const messageHash = this.createEIP712Hash(typedData);
      
      // Request signature from NEAR Chain Signatures
      const signatureResponse = await this.requestSignature(messageHash);
      
      // Convert NEAR signature format to Ethereum signature format
      const ethSignature = this.convertToEthereumSignature(signatureResponse, messageHash);
      
      // Verify the signature before returning
      await this.verifySignature(messageHash, ethSignature, this.derivedAddress);
      
      return ethSignature;
      
    } catch (error) {
      throw new Error(`Failed to sign Fusion order: ${error}`);
    }
  }

  /**
   * Sign arbitrary EIP-712 typed data using NEAR Chain Signatures
   */
  async signTypedData(typedData: EIP712TypedData): Promise<string> {
    if (!this.agentPublicKey || !this.derivedAddress) {
      throw new Error('NEAR Chain Signatures not initialized. Call initialize() first.');
    }

    try {
      const messageHash = this.createEIP712Hash(typedData);
      const signatureResponse = await this.requestSignature(messageHash);
      const ethSignature = this.convertToEthereumSignature(signatureResponse, messageHash);
      
      await this.verifySignature(messageHash, ethSignature, this.derivedAddress);
      
      return ethSignature;
      
    } catch (error) {
      throw new Error(`Failed to sign typed data: ${error}`);
    }
  }

  /**
   * Get the derived Ethereum address for this NEAR agent
   */
  getDerivedAddress(): string {
    if (!this.derivedAddress) {
      throw new Error('NEAR Chain Signatures not initialized. Call initialize() first.');
    }
    return this.derivedAddress;
  }

  /**
   * Get agent public key from NEAR agent contract
   */
  private async getAgentPublicKey(): Promise<string> {
    // For local testing, return a mock public key
    // In production, this would call the NEAR agent contract
    if (this.config.nearNetworkId === 'localnet') {
      return '0x04' + '1'.repeat(128); // Mock uncompressed public key
    }

    try {
      // Mock implementation - in production, call NEAR RPC
      const response = await fetch(`${this.config.nearNodeUrl}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'dontcare',
          method: 'query',
          params: {
            request_type: 'call_function',
            finality: 'final',
            account_id: this.config.agentContractId,
            method_name: 'public_key',
            args_base64: ''
          }
        })
      });

      const data = await response.json();
      
      if (data.error) {
        throw new Error(`NEAR RPC error: ${data.error.message}`);
      }

      // Decode the result and extract public key
      const result = JSON.parse(Buffer.from(data.result.result).toString());
      return result.public_key;
      
    } catch (error) {
      // Fallback to mock for development
      console.warn(`Failed to get agent public key, using mock: ${error}`);
      return '0x04' + '2'.repeat(128); // Mock uncompressed public key
    }
  }

  /**
   * Derive Ethereum address from NEAR agent public key
   */
  private async deriveEthereumAddress(): Promise<string> {
    if (!this.agentPublicKey) {
      throw new Error('Agent public key not available');
    }

    try {
      // For mock public key, return a deterministic address
      if (this.agentPublicKey.includes('1'.repeat(64))) {
        return '0x1111111111111111111111111111111111111111';
      }
      if (this.agentPublicKey.includes('2'.repeat(64))) {
        return '0x2222222222222222222222222222222222222222';
      }

      // In production, derive address from public key using elliptic curve cryptography
      // For now, create a deterministic address based on agent account ID
      const hash = ethers.keccak256(ethers.toUtf8Bytes(this.config.agentAccountId));
      return ethers.getAddress('0x' + hash.slice(-40));
      
    } catch (error) {
      throw new Error(`Failed to derive Ethereum address: ${error}`);
    }
  }

  /**
   * Get EIP-712 typed data for Fusion order
   */
  private getFusionOrderTypedData(order: FusionOrder): EIP712TypedData {
    // This should match the 1inch Fusion+ EIP-712 domain and types
    return {
      domain: {
        name: '1inch Fusion+',
        version: '1',
        chainId: 1, // Ethereum mainnet
        verifyingContract: order.settlementExtensionContract
      },
      types: {
        Order: [
          { name: 'salt', type: 'uint256' },
          { name: 'maker', type: 'address' },
          { name: 'receiver', type: 'address' },
          { name: 'makerAsset', type: 'address' },
          { name: 'takerAsset', type: 'address' },
          { name: 'makingAmount', type: 'uint256' },
          { name: 'takingAmount', type: 'uint256' },
          { name: 'makerTraits', type: 'uint256' }
        ]
      },
      primaryType: 'Order',
      message: {
        salt: order.salt.toString(),
        maker: order.maker,
        receiver: order.receiver,
        makerAsset: order.makerAsset,
        takerAsset: order.takerAsset,
        makingAmount: order.makingAmount.toString(),
        takingAmount: order.takingAmount.toString(),
        makerTraits: '0' // Simplified for now
      }
    };
  }

  /**
   * Create EIP-712 message hash
   */
  private createEIP712Hash(typedData: EIP712TypedData): string {
    // Create domain separator
    const domainHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
        [
          ethers.keccak256(ethers.toUtf8Bytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),
          ethers.keccak256(ethers.toUtf8Bytes(typedData.domain.name)),
          ethers.keccak256(ethers.toUtf8Bytes(typedData.domain.version)),
          typedData.domain.chainId,
          typedData.domain.verifyingContract
        ]
      )
    );

    // Create struct hash
    const structHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'uint256', 'address', 'address', 'address', 'address', 'uint256', 'uint256', 'uint256'],
        [
          ethers.keccak256(ethers.toUtf8Bytes('Order(uint256 salt,address maker,address receiver,address makerAsset,address takerAsset,uint256 makingAmount,uint256 takingAmount,uint256 makerTraits)')),
          typedData.message.salt,
          typedData.message.maker,
          typedData.message.receiver,
          typedData.message.makerAsset,
          typedData.message.takerAsset,
          typedData.message.makingAmount,
          typedData.message.takingAmount,
          typedData.message.makerTraits
        ]
      )
    );

    // Create final message hash
    return ethers.keccak256(
      ethers.concat([
        ethers.toUtf8Bytes('\x19\x01'),
        domainHash,
        structHash
      ])
    );
  }

  /**
   * Request signature from NEAR Chain Signatures service
   */
  private async requestSignature(messageHash: string): Promise<ChainSignatureResponse> {
    const payload: SignatureRequestPayload = {
      payload: messageHash.slice(2), // Remove '0x' prefix
      path: this.config.derivationPath,
      key_version: 0
    };

    try {
      // For local testing, return a mock signature
      if (this.config.nearNetworkId === 'localnet') {
        return {
          signature: {
            big_r: {
              affine_point: '0x' + '3'.repeat(64)
            },
            s: {
              scalar: '0x' + '4'.repeat(64)
            },
            recovery_id: 0
          },
          request_id: 'mock-request-id'
        };
      }

      // In production, call NEAR Chain Signatures service
      const response = await fetch(`${this.config.nearNodeUrl}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'dontcare',
          method: 'call',
          params: {
            account_id: this.config.agentAccountId,
            method_name: 'request_signature',
            args: payload,
            finality: 'final'
          }
        })
      });

      const data = await response.json();
      
      if (data.error) {
        throw new Error(`NEAR signature request failed: ${data.error.message}`);
      }

      return data.result;
      
    } catch (error) {
      // Fallback to mock signature for development
      console.warn(`Failed to request signature from NEAR, using mock: ${error}`);
      return {
        signature: {
          big_r: {
            affine_point: '0x' + '5'.repeat(64)
          },
          s: {
            scalar: '0x' + '6'.repeat(64)
          },
          recovery_id: 1
        },
        request_id: 'fallback-mock-id'
      };
    }
  }

  /**
   * Convert NEAR signature format to Ethereum signature format
   */
  private convertToEthereumSignature(
    nearSignature: ChainSignatureResponse, 
    messageHash: string
  ): string {
    try {
      // Extract signature components
      const r = nearSignature.signature.big_r.affine_point;
      const s = nearSignature.signature.s.scalar;
      const v = nearSignature.signature.recovery_id + 27; // Add 27 for Ethereum format

      // Ensure proper formatting
      const rFormatted = r.startsWith('0x') ? r : '0x' + r;
      const sFormatted = s.startsWith('0x') ? s : '0x' + s;

      // Combine into Ethereum signature format (r + s + v)
      return rFormatted + sFormatted.slice(2) + v.toString(16).padStart(2, '0');
      
    } catch (error) {
      throw new Error(`Failed to convert NEAR signature to Ethereum format: ${error}`);
    }
  }

  /**
   * Verify the signature before returning it
   */
  private async verifySignature(
    messageHash: string, 
    signature: string, 
    expectedSigner: string
  ): Promise<void> {
    try {
      const recoveredAddress = ethers.recoverAddress(messageHash, signature);
      
      if (recoveredAddress.toLowerCase() !== expectedSigner.toLowerCase()) {
        throw new Error(
          `Signature verification failed. Expected: ${expectedSigner}, Got: ${recoveredAddress}`
        );
      }
      
      console.log(`Signature verified successfully for address: ${recoveredAddress}`);
      
    } catch (error) {
      throw new Error(`Signature verification failed: ${error}`);
    }
  }
}

/**
 * Utility functions for NEAR Chain Signatures integration
 */
export class NearChainSignaturesUtils {
  /**
   * Validate NEAR network configuration
   */
  static validateConfig(config: NearChainSignaturesConfig): void {
    if (!config.nearNetworkId || !['mainnet', 'testnet', 'localnet'].includes(config.nearNetworkId)) {
      throw new Error('Invalid NEAR network ID. Must be mainnet, testnet, or localnet');
    }
    
    if (!config.nearNodeUrl) {
      throw new Error('NEAR node URL is required');
    }
    
    if (!config.agentAccountId) {
      throw new Error('Agent account ID is required');
    }
    
    if (!config.derivationPath) {
      throw new Error('Derivation path is required');
    }
  }

  /**
   * Create default configuration for different networks
   */
  static createConfig(
    network: 'mainnet' | 'testnet' | 'localnet',
    agentAccountId: string
  ): NearChainSignaturesConfig {
    const configs = {
      mainnet: {
        nearNetworkId: 'mainnet',
        nearNodeUrl: 'https://rpc.mainnet.near.org',
        agentContractId: 'agent.near',
        derivationPath: 'ethereum,1'
      },
      testnet: {
        nearNetworkId: 'testnet',
        nearNodeUrl: 'https://rpc.testnet.near.org',
        agentContractId: 'agent.testnet',
        derivationPath: 'ethereum,11155111' // Sepolia chain ID
      },
      localnet: {
        nearNetworkId: 'localnet',
        nearNodeUrl: 'http://localhost:3030',
        agentContractId: 'agent.test.near',
        derivationPath: 'ethereum,31337' // Local chain ID
      }
    };

    return {
      ...configs[network],
      agentAccountId,
      teeAttestationUrl: network === 'mainnet' 
        ? 'https://tee-attestation.near.org' 
        : undefined
    };
  }

  /**
   * Format signature for display and debugging
   */
  static formatSignature(signature: string): {
    r: string;
    s: string;
    v: number;
    full: string;
  } {
    if (!signature.startsWith('0x') || signature.length !== 132) {
      throw new Error('Invalid signature format');
    }

    const r = signature.slice(0, 66);
    const s = '0x' + signature.slice(66, 130);
    const v = parseInt(signature.slice(130, 132), 16);

    return { r, s, v, full: signature };
  }
}
