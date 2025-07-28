import { expect } from '@jest/globals';
import { ethers } from 'ethers';
import { Wallet } from './wallet';
import { Resolver } from './resolver';
import { EscrowFactory } from './escrow-factory';

describe('NEAR Integration', () => {
  let nearResolver: Resolver;
  let nearEscrowFactory: EscrowFactory;
  let userWallet: Wallet;
  let resolverWallet: Wallet;
  
  const NEAR_RECIPIENT = 'test-near-account.near';
  const SECRET = ethers.keccak256(ethers.toUtf8Bytes('test-secret'));
  const SECRET_HASH = ethers.keccak256(SECRET);
  const DEPOSIT_AMOUNT = ethers.parseEther('1.0');
  
  beforeAll(async () => {
    // Initialize wallets
    userWallet = new Wallet(process.env.USER_PRIVATE_KEY || '');
    resolverWallet = new Wallet(process.env.RESOLVER_PRIVATE_KEY || '');
    
    // Deploy or get contract instances
    // Note: In a real test, you would deploy these contracts or get their addresses from the environment
    // This is a simplified example
    nearResolver = new Resolver(/* Resolver contract address */);
    nearEscrowFactory = new EscrowFactory(/* Factory contract address */);
  });
  
  it('should create a NEAR escrow', async () => {
    // Create a NEAR escrow
    const tx = await nearEscrowFactory.createDstEscrow(
      {
        chainId: { get: () => 397 }, // NEAR chain ID
        taker: { get: () => userWallet.address },
        recipient: NEAR_RECIPIENT,
        amount: { get: () => DEPOSIT_AMOUNT },
        secretHash: { get: () => SECRET_HASH },
        timelock: { get: () => Math.floor(Date.now() / 1000) + 86400 } // 24 hours from now
      },
      Math.floor(Date.now() / 1000) + 172800 // 48 hours from now
    );
    
    // Wait for the transaction to be mined
    const receipt = await tx.wait();
    
    // Check that the escrow was created
    expect(receipt.status).toBe(1);
    
    // Get the escrow address from the event
    const event = receipt.events?.find((e: any) => e.event === 'NearEscrowCreated');
    const escrowAddress = event?.args?.escrowAddress;
    
    expect(escrowAddress).toBeDefined();
    
    // Verify it's a NEAR escrow
    const isNearEscrow = await nearEscrowFactory.isNearEscrow(escrowAddress);
    expect(isNearEscrow).toBe(true);
  });
  
  it('should handle a NEAR deposit', async () => {
    // This would be called by the relayer when a NEAR deposit is detected
    const tx = await nearResolver.completeNearWithdrawal(
      SECRET,
      NEAR_RECIPIENT
    );
    
    const receipt = await tx.wait();
    expect(receipt.status).toBe(1);
    
    // Check that the withdrawal was processed
    const event = receipt.events?.find((e: any) => e.event === 'NearWithdrawalCompleted');
    expect(event).toBeDefined();
    expect(event.args?.nearRecipient).toBe(NEAR_RECIPIENT);
    expect(event.args?.amount).toBe(DEPOSIT_AMOUNT);
  });
  
  it('should allow refund after timelock', async () => {
    // Fast forward time to after the timelock
    await network.provider.send('evm_increaseTime', [86401]); // 24 hours + 1 second
    await network.provider.send('evm_mine');
    
    // Try to refund the deposit
    const tx = await nearResolver.refundNearDeposit(SECRET_HASH);
    const receipt = await tx.wait();
    
    expect(receipt.status).toBe(1);
    
    // Check that the refund was processed
    const event = receipt.events?.find((e: any) => e.event === 'NearRefunded');
    expect(event).toBeDefined();
    expect(event.args?.nearRecipient).toBe(NEAR_RECIPIENT);
    expect(event.args?.amount).toBe(DEPOSIT_AMOUNT);
  });
});
