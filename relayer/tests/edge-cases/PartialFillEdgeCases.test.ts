import { ethers } from 'ethers';
import { jest } from '@jest/globals';
import { EscrowSearchParams } from '../../src/types/interfaces';

// Import mock after jest.mock
import { MockProvider } from '../mocks/ethers-mock-enhanced';

// Type-safe mock implementations
const mockValidationService = {
  validateEthereumAddress: jest.fn(async (address: string): Promise<boolean> => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new Error('Invalid Ethereum address');
    }
    return true;
  }),
  
  validateSecret: jest.fn(async (secret: string): Promise<boolean> => {
    if (!secret || typeof secret !== 'string' || secret.trim() === '') {
      throw new Error('Secret is required');
    }
    return true;
  }),
  
  validateAmount: jest.fn(async (amount: string | bigint): Promise<boolean> => {
    const amountStr = amount.toString();
    if (!/^\d+$/.test(amountStr) || BigInt(amountStr) <= 0n) {
      throw new Error('Invalid amount');
    }
    return true;
  }),
  
  validateEscrowDetails: jest.fn(async (details: unknown): Promise<boolean> => {
    if (!details) {
      throw new Error('Escrow details are required');
    }
    return true;
  })
};

// Mock the ValidationService
jest.mock('../../src/services/ValidationService', () => ({
  ValidationService: jest.fn(() => mockValidationService)
}));

// Import the service after setting up mocks
import { EthereumContractService } from '../../src/services/EthereumContractService';

describe('EthereumContractService Edge Cases', () => {
  let service: EthereumContractService;
  let mockProvider: MockProvider;
  let mockSigner: ethers.Wallet;
  const factoryAddress = '0x1234567890123456789012345678901234567890';

  beforeEach(() => {
    // Create a mock provider and signer
    mockProvider = new MockProvider();
    mockSigner = new ethers.Wallet(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // Hardhat default private key
      mockProvider as any
    );
    
    // Mock the getAddress method
    jest.spyOn(mockSigner, 'getAddress').mockResolvedValue('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
    
    // Initialize the service with mock provider and signer
    service = new EthereumContractService(
      mockProvider as unknown as ethers.providers.JsonRpcProvider,
      mockSigner as unknown as ethers.Signer,
      factoryAddress
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getEscrowDetails', () => {
    it('should handle invalid escrow address', async () => {
      const invalidAddress = '0xinvalid';
      
      await expect(service.getEscrowDetails(invalidAddress))
        .rejects
        .toThrow('Invalid Ethereum address');
    });

    it('should handle contract call failure', async () => {
      const escrowAddress = '0x1234567890123456789012345678901234567891';
      const mockError = new Error('Contract call failed');
      
      // Mock the contract call to fail
      jest.spyOn(service as any, 'getEscrowDetails').mockRejectedValue(mockError);
      
      await expect(service.getEscrowDetails(escrowAddress))
        .rejects
        .toThrow('Failed to get escrow details');
    });
  });

  describe('findEscrowBySecretHash', () => {
    it('should handle empty secret hash', async () => {
      await expect(service.findEscrowBySecretHash(''))
        .rejects
        .toThrow('Secret hash is required');
    });

    it('should handle search with no results', async () => {
      const secretHash = '0x' + '1'.repeat(64);
      
      // Mock the search to return no results
      jest.spyOn(service as any, 'findEscrowByParams').mockResolvedValue(null);
      
      const result = await service.findEscrowBySecretHash(secretHash, 100);
      
      expect(result).toBeNull();
    });
  });

  describe('executeWithdrawal', () => {
    it('should handle invalid secret', async () => {
      const escrowAddress = '0x1234567890123456789012345678901234567891';
      const invalidSecret = '';
      
      await expect(service.executeWithdrawal(escrowAddress, invalidSecret))
        .rejects
        .toThrow('Secret is required');
    });

    it('should handle withdrawal failure', async () => {
      const escrowAddress = '0x1234567890123456789012345678901234567891';
      const secret = 'valid-secret';
      const mockError = new Error('Withdrawal failed');
      
      // Mock the contract call to fail
      jest.spyOn(service as any, 'executeTransaction').mockRejectedValue(mockError);
      
      await expect(service.executeWithdrawal(escrowAddress, secret))
        .rejects
        .toThrow('Failed to execute withdrawal');
    });
  });

  describe('executeRefund', () => {
    it('should handle refund failure', async () => {
      const escrowAddress = '0x1234567890123456789012345678901234567891';
      const mockError = new Error('Refund failed');
      
      // Mock the contract call to fail
      jest.spyOn(service as any, 'executeTransaction').mockRejectedValue(mockError);
      
      await expect(service.executeRefund(escrowAddress))
        .rejects
        .toThrow('Failed to execute refund');
    });
  });

  describe('findEscrowByParams', () => {
    it('should handle invalid search parameters', async () => {
      const invalidParams = {} as EscrowSearchParams;
      
      await expect(service.findEscrowByParams(invalidParams))
        .rejects
        .toThrow('At least one search parameter is required');
    });

    it('should handle search with invalid block range', async () => {
      const params: EscrowSearchParams = {
        initiator: '0x1234567890123456789012345678901234567890',
        maxBlocksToSearch: 0 // Invalid block range
      };
      
      await expect(service.findEscrowByParams(params))
        .rejects
        .toThrow('Invalid max blocks to search');
    });
  });
});
