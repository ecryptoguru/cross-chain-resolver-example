/**
 * Comprehensive unit tests for EthereumContractService
 * Tests Ethereum contract interactions, escrow operations, and error handling
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { EthereumContractService, EscrowSearchParams } from '../../src/services/EthereumContractService.js';
import { EthereumEscrowDetails } from '../../src/types/interfaces.js';
import { ContractError, ValidationError } from '../../src/utils/errors.js';
import { MockProvider, MockSigner, MockContract, mockEthers } from '../mocks/ethers-mock.js';

describe('EthereumContractService', () => {
  let ethereumContractService: EthereumContractService;
  let mockProvider: any;
  let mockSigner: any;
  const factoryAddress = '0x1234567890123456789012345678901234567890';

  // Setup function to initialize mocks and service
  function setupTest() {
    mockProvider = new MockProvider();
    mockSigner = new MockSigner(mockProvider);
    
    // Initialize the EthereumContractService with mocks
    ethereumContractService = new EthereumContractService(
      mockProvider as any,
      mockSigner as any,
      factoryAddress
    );
  }

  // Setup before each test
  test('should setup mock dependencies', () => {
    setupTest();
    
    // Verify mocks and service are properly initialized
    assert(mockProvider);
    assert(mockSigner);
    assert(ethereumContractService);
  });

  describe('Constructor', () => {
    test('should initialize with valid parameters', () => {
      const service = new EthereumContractService(mockProvider, mockSigner, factoryAddress);
      assert(service instanceof EthereumContractService);
    });

    test('should throw error for invalid provider', () => {
      assert.throws(() => {
        new EthereumContractService(null as any, mockSigner, factoryAddress);
      }, ValidationError);
    });

    test('should throw error for invalid factory address', () => {
      assert.throws(() => {
        new EthereumContractService(mockProvider, mockSigner, 'invalid_address');
      }, ValidationError);
    });
  });

  describe('getContractDetails', () => {
    test('should get escrow contract details', async () => {
      setupTest();
      const escrowAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
      const mockEscrowDetails = {
        status: 1,
        token: '0x0000000000000000000000000000000000000000',
        amount: '1000000000000000000',
        timelock: Math.floor(Date.now() / 1000) + 3600,
        secretHash: '0x' + 'a'.repeat(64),
        initiator: '0x1111111111111111111111111111111111111111',
        recipient: '0x2222222222222222222222222222222222222222',
        chainId: 1
      };

      const mockContract = new MockContract('0x1234567890123456789012345678901234567890', [], mockSigner);
      // Mock the getDetails method directly on the contract
      (mockContract as any).getDetails = async () => mockEscrowDetails;
      mockProvider.setMockContract(mockContract);

      const details = await ethereumContractService.getContractDetails(escrowAddress);
      
      assert(details);
      assert.strictEqual(details.status, 1);
      assert.strictEqual(details.amount.toString(), '1000000000000000000');
    });

    test('should throw error for invalid address', async () => {
      setupTest();
      await assert.rejects(
        ethereumContractService.getContractDetails('invalid_address'),
        ValidationError
      );
    });
  });

  describe('executeTransaction', () => {
    test('should execute transaction successfully', async () => {
      setupTest();
      const contractAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
      const method = 'withdraw';
      const params = ['secret123'];

      const mockContract = new MockContract('0x1234567890123456789012345678901234567890', [], mockSigner);
      const mockTx = {
        hash: '0xtx123',
        nonce: 42,
        gasLimit: mockEthers.BigNumber.from('21000'),
        gasPrice: mockEthers.BigNumber.from('20000000000'),
        data: '0x',
        value: mockEthers.BigNumber.from('0'),
        chainId: 1,
        wait: async () => ({ status: 1, transactionHash: '0xtx123' })
      };
      // Mock the method directly on the contract
      (mockContract as any)[method] = async () => mockTx;
      mockSigner.setMockContract(mockContract);

      const result = await ethereumContractService.executeTransaction(contractAddress, method, params);
      
      assert(result);
      assert.strictEqual(result.hash, '0xtx123');
    });

    test('should validate input parameters', async () => {
      setupTest();
      await assert.rejects(
        ethereumContractService.executeTransaction('invalid_address', 'method', []),
        ValidationError
      );

      await assert.rejects(
        ethereumContractService.executeTransaction(factoryAddress, '', []),
        ValidationError
      );
    });
  });

  describe('findEscrowBySecretHash', () => {
    test('should find escrow by secret hash', async () => {
      setupTest();
      const secretHash = '0x' + 'a'.repeat(64);
      const mockEscrowAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
      
      const mockFactoryContract = new MockContract('0x1234567890123456789012345678901234567890', [], mockSigner);
      const mockEvents = [{
        args: {
          escrow: mockEscrowAddress,
          secretHash
        }
      }];
      // Mock the queryFilter method directly on the contract
      (mockFactoryContract as any).queryFilter = async () => mockEvents;
      mockProvider.setMockContract(mockFactoryContract);

      const mockEscrowContract = new MockContract('0x1234567890123456789012345678901234567890', [], mockSigner);
      const mockDetails = {
        status: 1,
        secretHash,
        amount: '1000000000000000000',
        timelock: Math.floor(Date.now() / 1000) + 3600,
        initiator: '0x1111111111111111111111111111111111111111',
        recipient: '0x2222222222222222222222222222222222222222'
      };
      // Mock the getDetails method directly on the contract
      (mockEscrowContract as any).getDetails = async () => mockDetails;
      mockProvider.setMockContractForAddress(mockEscrowAddress, mockEscrowContract);

      const escrow = await ethereumContractService.findEscrowBySecretHash(secretHash);
      
      assert(escrow);
      assert.strictEqual(escrow.secretHash, secretHash);
    });

    test('should validate secret hash', async () => {
      setupTest();
      await assert.rejects(
        ethereumContractService.findEscrowBySecretHash(''),
        ValidationError
      );
    });
  });

  describe('executeWithdrawal', () => {
    test('should execute withdrawal successfully', async () => {
      setupTest();
      const escrowAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
      const secret = 'secret123';

      const mockEscrowContract = new MockContract('0x1234567890123456789012345678901234567890', [], mockSigner);
      const mockDetails = {
        status: 1,
        timelock: Math.floor(Date.now() / 1000) + 3600,
        recipient: '0x2222222222222222222222222222222222222222'
      };
      // Mock the getDetails method directly on the contract
      (mockEscrowContract as any).getDetails = async () => mockDetails;

      const mockTx = {
        hash: '0xwithdraw123',
        wait: async () => ({ 
          status: 1, 
          transactionHash: '0xwithdraw123',
          gasUsed: mockEthers.BigNumber.from('21000')
        })
      };
      // Mock the withdraw method directly on the contract
      (mockEscrowContract as any).withdraw = async () => mockTx;
      
      mockSigner.setMockContract(mockEscrowContract);
      mockProvider.setMockContract(mockEscrowContract);

      const receipt = await ethereumContractService.executeWithdrawal(escrowAddress, secret);
      
      assert(receipt);
      assert.strictEqual(receipt.status, 1);
    });

    test('should validate withdrawal parameters', async () => {
      setupTest();
      await assert.rejects(
        ethereumContractService.executeWithdrawal('', 'secret'),
        ValidationError
      );
    });
  });

  describe('executeRefund', () => {
    test('should execute refund successfully', async () => {
      setupTest();
      const escrowAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

      const mockEscrowContract = new MockContract('0x1234567890123456789012345678901234567890', [], mockSigner);
      const mockDetails = {
        status: 1,
        timelock: Math.floor(Date.now() / 1000) - 3600, // Expired
        initiator: '0x1111111111111111111111111111111111111111'
      };
      // Mock the getDetails method directly on the contract
      (mockEscrowContract as any).getDetails = async () => mockDetails;

      const mockTx = {
        hash: '0xrefund123',
        wait: async () => ({ 
          status: 1, 
          transactionHash: '0xrefund123',
          gasUsed: mockEthers.BigNumber.from('21000')
        })
      };
      // Mock the refund method directly on the contract
      (mockEscrowContract as any).refund = async () => mockTx;
      
      mockSigner.setMockContract(mockEscrowContract);
      mockProvider.setMockContract(mockEscrowContract);

      const receipt = await ethereumContractService.executeRefund(escrowAddress);
      
      assert(receipt);
      assert.strictEqual(receipt.status, 1);
    });

    test('should check timelock before refund', async () => {
      setupTest();
      const escrowAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

      const mockEscrowContract = new MockContract('0x1234567890123456789012345678901234567890', [], mockSigner);
      const mockDetails = {
        status: 1,
        timelock: Math.floor(Date.now() / 1000) + 3600, // Not expired
        initiator: '0x1111111111111111111111111111111111111111'
      };
      // Mock the getDetails method directly on the contract
      (mockEscrowContract as any).getDetails = async () => mockDetails;
      mockProvider.setMockContract(mockEscrowContract);

      await assert.rejects(
        ethereumContractService.executeRefund(escrowAddress),
        ContractError
      );
    });
  });

  describe('Error Handling', () => {
    test('should handle network errors gracefully', async () => {
      setupTest();
      mockProvider.setMockError(new Error('Network error'));

      await assert.rejects(
        ethereumContractService.getContractDetails(factoryAddress),
        ContractError
      );
    });
  });

  describe('Search Criteria Matching', () => {
    test('should match exact amounts', () => {
      setupTest();
      const details: EthereumEscrowDetails = {
        status: 1,
        amount: '1000000000000000000',
        secretHash: '0x' + 'a'.repeat(64),
        timelock: 0,
        initiator: '0x1111111111111111111111111111111111111111',
        recipient: '0x2222222222222222222222222222222222222222',
        token: '0x0000000000000000000000000000000000000000',
        chainId: 1
      };

      const params: EscrowSearchParams = {
        amount: '1.0'
      };

      const matches = (ethereumContractService as any).matchesSearchCriteria(details, params);
      assert.strictEqual(matches, true);
    });
  });
});
