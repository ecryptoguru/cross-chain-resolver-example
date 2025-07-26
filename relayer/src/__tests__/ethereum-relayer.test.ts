import { ethers } from 'ethers';
import { EthereumRelayer } from '../relay/ethereum';
import { logger } from '../utils/logger';

// Mock logger to prevent console output during tests
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
}));

// Mock ethers provider and signer
jest.mock('ethers');

// Mock the NEAR account
const mockNearAccount = {
  functionCall: jest.fn().mockResolvedValue({ transaction: { hash: '0x123' } }),
};

describe('EthereumRelayer', () => {
  let ethereumRelayer: EthereumRelayer;
  let mockProvider: jest.Mocked<ethers.Provider>;
  let mockSigner: jest.Mocked<ethers.Signer>;
  let mockContract: jest.Mocked<ethers.Contract>;

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Setup mock provider and signer
    mockProvider = {
      getBlockNumber: jest.fn().mockResolvedValue(1000),
      on: jest.fn(),
      removeAllListeners: jest.fn(),
    } as unknown as jest.Mocked<ethers.Provider>;

    mockSigner = {
      getAddress: jest.fn().mockResolvedValue('0x1234567890123456789012345678901234567890'),
      provider: mockProvider,
    } as unknown as jest.Mocked<ethers.Signer>;

    // Setup mock contract
    mockContract = {
      on: jest.fn(),
      queryFilter: jest.fn().mockResolvedValue([]),
      getDetails: jest.fn().mockResolvedValue({
        status: 0, // Active
        expiresAt: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
      }),
    } as unknown as jest.Mocked<ethers.Contract>;

    // Mock ethers.Contract to return our mock contract
    (ethers.Contract as jest.Mock).mockImplementation(() => mockContract);

    // Create the relayer instance
    ethereumRelayer = new EthereumRelayer(
      mockProvider,
      mockSigner,
      mockNearAccount as any
    );
  });

  describe('start', () => {
    it('should start the relayer and set up event listeners', async () => {
      // Mock the block listener
      const mockListener = jest.fn();
      (mockProvider.on as jest.Mock).mockImplementation((event, listener) => {
        if (event === 'block') {
          mockListener();
        }
      });
      
      await ethereumRelayer.start();
      
      // Verify the block listener was set up
      expect(mockProvider.on).toHaveBeenCalledWith('block', expect.any(Function));
      
      // Verify the startup message was logged
      expect(logger.info).toHaveBeenCalledWith('Ethereum relayer started');
    });
  });

  describe('stop', () => {
    it('should stop the relayer and clean up listeners', async () => {
      await ethereumRelayer.start();
      await ethereumRelayer.stop();
      expect(mockProvider.removeAllListeners).toHaveBeenCalledWith('block');
      expect(logger.info).toHaveBeenCalledWith('Ethereum relayer stopped');
    });
  });

  describe('handleEthereumToNearSwap', () => {
    it('should process a valid escrow creation event', async () => {
      // Mock the escrow contract
      const mockEscrow = {
        getDetails: jest.fn().mockResolvedValue({
          status: 0, // Active
          expiresAt: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
        }),
        connect: jest.fn().mockReturnThis(),
        setStatus: jest.fn().mockResolvedValue({
          wait: jest.fn().mockResolvedValue({}),
        }),
      };
      
      (ethers.Contract as jest.Mock).mockImplementation(() => mockEscrow);

      // Call the method directly for testing
      await ethereumRelayer['handleEthereumToNearSwap'](
        '0xEscrowAddress',
        '0xInitiator',
        '0xTokenAddress',
        BigInt('1000000000000000000'), // 1 token with 18 decimals
        '0xTargetAddress'
      );

      // Verify the NEAR escrow was created
      expect(mockNearAccount.functionCall).toHaveBeenCalledWith({
        contractId: expect.any(String),
        methodName: 'create_escrow',
        args: expect.objectContaining({
          escrow_id: 'eth:0xescrowaddress',
          initiator: '0xInitiator',
          token: '0xTokenAddress',
          amount: '1000000000000000000',
          source_chain: 'ethereum',
          source_address: '0xEscrowAddress',
        }),
        gas: '300000000000000',
        attachedDeposit: '1',
      });

      // Verify the escrow status was updated
      expect(mockEscrow.connect).toHaveBeenCalledWith(mockSigner);
      expect(mockEscrow.setStatus).toHaveBeenCalledWith(1); // Pending
    });

    it('should handle errors during escrow processing', async () => {
      // Mock the escrow contract to throw an error
      const mockEscrow = {
        getDetails: jest.fn().mockRejectedValue(new Error('Failed to get details')),
      };
      
      (ethers.Contract as jest.Mock).mockImplementation(() => mockEscrow);

      // Call the method and expect it to throw
      await expect(
        ethereumRelayer['handleEthereumToNearSwap'](
          '0xEscrowAddress',
          '0xInitiator',
          '0xTokenAddress',
          BigInt('1000000000000000000'),
          '0xTargetAddress'
        )
      ).rejects.toThrow('Failed to process Ethereum to NEAR swap');

      // Verify error was logged
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to process Ethereum to NEAR swap'),
        expect.any(Error)
      );
    });
  });
});
