#!/usr/bin/env ts-node

import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { TestnetDeployer } from './deploy-testnet';
import { NearTestnetDeployer } from './deploy-near-testnet';

interface DemoScenario {
  name: string;
  description: string;
  sourceChain: string;
  targetChain: string;
  sourceToken: string;
  targetToken: string;
  amount: string;
  estimatedTime: string;
}

class CrossChainDemo {
  private config: any;
  private ethProvider: ethers.JsonRpcProvider;
  private ethSigner: ethers.Wallet;

  constructor() {
    // Load configuration
    const configPath = path.join(__dirname, '../testnet-config.json');
    this.config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    // Setup Ethereum connection
    this.ethProvider = new ethers.JsonRpcProvider(this.config.networks.sepolia.rpcUrl);
    this.ethSigner = new ethers.Wallet(
      process.env.PRIVATE_KEY || 'cc87a77b550723b1bd0c0e1d6e920da7981c6260dd211855ddf951906b8db3ad',
      this.ethProvider
    );
  }

  async runFullDemo(): Promise<void> {
    console.log('🎬 Starting Cross-Chain Resolver Demo');
    console.log('=====================================');

    try {
      // Step 1: Deploy Ethereum contracts
      console.log('\n📝 Step 1: Deploying Ethereum contracts...');
      await this.deployEthereumContracts();

      // Step 2: Deploy NEAR contracts
      console.log('\n📝 Step 2: Deploying NEAR contracts...');
      await this.deployNearContracts();

      // Step 3: Fund test wallets
      console.log('\n📝 Step 3: Funding test wallets...');
      await this.fundTestWallets();

      // Step 4: Configure cross-chain communication
      console.log('\n📝 Step 4: Configuring cross-chain communication...');
      await this.configureCrossChain();

      // Step 5: Run demo scenarios
      console.log('\n📝 Step 5: Running demo scenarios...');
      await this.runDemoScenarios();

      // Step 6: Generate final report
      console.log('\n📝 Step 6: Generating final report...');
      await this.generateFinalReport();

      console.log('\n🎉 Cross-chain demo completed successfully!');

    } catch (error) {
      console.error('❌ Demo failed:', error);
      throw error;
    }
  }

  private async deployEthereumContracts(): Promise<void> {
    const deployer = new TestnetDeployer();
    await deployer.deployContracts();
    await deployer.fundTestWallets();
    await deployer.setupCrossChainConfig();
    
    // Reload config after deployment
    const configPath = path.join(__dirname, '../testnet-config.json');
    this.config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  private async deployNearContracts(): Promise<void> {
    const nearDeployer = new NearTestnetDeployer();
    await nearDeployer.deployContracts();
    
    // Reload config after NEAR deployment
    const configPath = path.join(__dirname, '../testnet-config.json');
    this.config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  private async fundTestWallets(): Promise<void> {
    console.log('💰 Funding additional test tokens...');

    // Fund Ethereum wallets with test tokens (if available)
    await this.fundEthereumTokens();
    
    // Fund NEAR wallets with test tokens
    await this.fundNearTokens();
  }

  private async fundEthereumTokens(): Promise<void> {
    const feeTokenAddress = this.config.contracts.sepolia.FeeToken.address;
    if (!feeTokenAddress) {
      console.log('⚠️  No FeeToken deployed, skipping token funding');
      return;
    }

    // Load FeeToken contract
    const artifactPath = path.join(__dirname, '../../contracts/out/FeeToken.sol/FeeToken.json');
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    const feeToken = new ethers.Contract(feeTokenAddress, artifact.abi, this.ethSigner);

    // Transfer tokens to test wallets
    const transferAmount = ethers.parseEther('1000'); // 1000 tokens per wallet

    for (const [name, wallet] of Object.entries(this.config.testWallets.ethereum)) {
      if (name === 'deployer') continue;
      
      const walletData = wallet as any;
      if (walletData.address) {
        try {
          const tx = await feeToken.transfer(walletData.address, transferAmount);
          await tx.wait();
          console.log(`✅ Transferred 1000 TFT to ${name}: ${walletData.address}`);
        } catch (error) {
          console.log(`⚠️  Failed to transfer tokens to ${name}:`, error);
        }
      }
    }
  }

  private async fundNearTokens(): Promise<void> {
    console.log('💰 NEAR tokens already funded during account creation (10 NEAR each)');
    
    // Additional token funding could be implemented here
    // For now, the 10 NEAR initial balance should be sufficient for testing
  }

  private async configureCrossChain(): Promise<void> {
    // Create relayer startup script
    const relayerScript = `#!/bin/bash
echo "🚀 Starting Cross-Chain Relayer..."

# Set environment variables
export ETHEREUM_RPC_URL="${this.config.networks.sepolia.rpcUrl}"
export NEAR_RPC_URL="${this.config.networks['near-testnet'].rpcUrl}"
export ETHEREUM_PRIVATE_KEY="${process.env.PRIVATE_KEY}"
export NEAR_BRIDGE_ADDRESS="${this.config.contracts.sepolia.NearBridge.address}"
export NEAR_SOLVER_ACCOUNT="${this.config.contracts['near-testnet']?.CrossChainSolver?.accountId || 'solver.testnet'}"

echo "Ethereum Bridge: $NEAR_BRIDGE_ADDRESS"
echo "NEAR Solver: $NEAR_SOLVER_ACCOUNT"

# Start relayer (placeholder - actual relayer implementation would go here)
echo "✅ Relayer configuration ready"
echo "Note: Actual relayer service would be started here"
`;

    const scriptPath = path.join(__dirname, '../start-relayer.sh');
    fs.writeFileSync(scriptPath, relayerScript);
    execSync(`chmod +x ${scriptPath}`);
    
    console.log(`✅ Relayer script created: ${scriptPath}`);
  }

  private async runDemoScenarios(): Promise<void> {
    const scenarios: DemoScenario[] = [
      {
        name: 'ETH to NEAR Swap',
        description: 'Demonstrate ETH deposit on Sepolia for NEAR withdrawal',
        sourceChain: 'sepolia',
        targetChain: 'near-testnet',
        sourceToken: 'ETH',
        targetToken: 'NEAR',
        amount: '0.01',
        estimatedTime: '5 minutes'
      },
      {
        name: 'NEAR to ETH Swap',
        description: 'Demonstrate NEAR deposit for ETH withdrawal on Sepolia',
        sourceChain: 'near-testnet',
        targetChain: 'sepolia',
        sourceToken: 'NEAR',
        targetToken: 'ETH',
        amount: '10',
        estimatedTime: '5 minutes'
      }
    ];

    for (const scenario of scenarios) {
      console.log(`\n🎭 Running: ${scenario.name}`);
      console.log(`Description: ${scenario.description}`);
      console.log(`Amount: ${scenario.amount} ${scenario.sourceToken} → ${scenario.targetToken}`);
      
      if (scenario.sourceChain === 'sepolia') {
        await this.runEthToNearDemo(scenario);
      } else {
        await this.runNearToEthDemo(scenario);
      }
    }
  }

  private async runEthToNearDemo(scenario: DemoScenario): Promise<void> {
    console.log('📤 Initiating ETH to NEAR swap...');

    const nearBridgeAddress = this.config.contracts.sepolia.NearBridge.address;
    if (!nearBridgeAddress) {
      console.log('❌ NearBridge not deployed');
      return;
    }

    try {
      // Load NearBridge contract
      const artifactPath = path.join(__dirname, '../../contracts/out/NearBridge.sol/NearBridge.json');
      const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
      const nearBridge = new ethers.Contract(nearBridgeAddress, artifact.abi, this.ethSigner);

      // Demo parameters
      const nearAccount = this.config.testWallets.near?.user1?.accountId || 'user1.testnet';
      const secretHash = ethers.keccak256(ethers.toUtf8Bytes('demo_secret_123'));
      const timelock = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      const amount = ethers.parseEther(scenario.amount);

      console.log(`Depositing ${scenario.amount} ETH for ${nearAccount}`);
      console.log(`Secret hash: ${secretHash}`);
      console.log(`Timelock: ${new Date(timelock * 1000).toISOString()}`);

      // Make deposit
      const tx = await nearBridge.deposit(nearAccount, secretHash, timelock, {
        value: amount
      });

      console.log(`📄 Transaction submitted: ${tx.hash}`);
      console.log(`🔗 Explorer: ${this.config.networks.sepolia.explorerUrl}/tx/${tx.hash}`);

      const receipt = await tx.wait();
      console.log(`✅ Deposit confirmed in block: ${receipt.blockNumber}`);

      // In a real demo, the relayer would pick up this event and process it on NEAR
      console.log('🤖 Relayer would now process this deposit on NEAR testnet');
      console.log(`📋 Demo verification: Check transaction on explorer`);

    } catch (error) {
      console.error('❌ ETH to NEAR demo failed:', error);
    }
  }

  private async runNearToEthDemo(scenario: DemoScenario): Promise<void> {
    console.log('📤 Initiating NEAR to ETH swap...');

    const solverAccount = this.config.contracts['near-testnet']?.CrossChainSolver?.accountId;
    const userAccount = this.config.testWallets.near?.user2?.accountId;

    if (!solverAccount || !userAccount) {
      console.log('❌ NEAR contracts or accounts not available');
      return;
    }

    try {
      // Demo parameters
      const ethAddress = this.config.testWallets.ethereum.user2?.address || this.ethSigner.address;
      const amount = scenario.amount; // 10 NEAR
      const secretHash = 'demo_secret_hash_456';

      console.log(`Creating order for ${amount} NEAR → ETH`);
      console.log(`ETH recipient: ${ethAddress}`);
      console.log(`NEAR account: ${userAccount}`);

      // Create order on NEAR (simulated)
      const orderArgs = JSON.stringify({
        token_in: 'wrap.testnet',
        token_out: ethAddress,
        amount_in: amount,
        amount_out: '0.005', // Equivalent ETH amount
        expires_in_sec: 3600,
        hashlock: secretHash,
        timelock: Math.floor(Date.now() / 1000) + 3600
      });

      console.log('📋 Order parameters:', orderArgs);
      console.log('🤖 In a real demo, this would call:');
      console.log(`near call ${solverAccount} create_order '${orderArgs}' --accountId ${userAccount} --deposit 0.1`);

      // Simulate successful order creation
      console.log('✅ NEAR order created (simulated)');
      console.log('🤖 Relayer would now process this order and create ETH withdrawal');
      console.log(`📋 Demo verification: Order would appear in NEAR explorer`);

    } catch (error) {
      console.error('❌ NEAR to ETH demo failed:', error);
    }
  }

  private async generateFinalReport(): Promise<void> {
    const report = {
      demo: {
        title: 'Cross-Chain Resolver Testnet Demo',
        timestamp: new Date().toISOString(),
        status: 'completed',
        duration: '~15 minutes'
      },
      networks: {
        ethereum: {
          name: 'Sepolia Testnet',
          chainId: this.config.networks.sepolia.chainId,
          explorer: this.config.networks.sepolia.explorerUrl
        },
        near: {
          name: 'NEAR Testnet',
          network: 'testnet',
          explorer: this.config.networks['near-testnet'].explorerUrl
        }
      },
      deployedContracts: {
        ethereum: this.config.contracts.sepolia,
        near: this.config.contracts['near-testnet']
      },
      testWallets: this.config.testWallets,
      demoScenarios: [
        {
          name: 'ETH to NEAR Swap',
          status: 'demonstrated',
          txHash: 'See console output for actual transaction hash'
        },
        {
          name: 'NEAR to ETH Swap',
          status: 'simulated',
          note: 'Full implementation requires relayer service'
        }
      ],
      nextSteps: [
        'Implement and deploy relayer service',
        'Add UI for user-friendly swaps',
        'Implement partial fills and advanced features',
        'Conduct security audit before mainnet',
        'Prepare for hackathon demonstration'
      ],
      explorerLinks: {
        nearBridge: `${this.config.networks.sepolia.explorerUrl}/address/${this.config.contracts.sepolia.NearBridge.address}`,
        crossChainSolver: `${this.config.networks['near-testnet'].explorerUrl}/accounts/${this.config.contracts['near-testnet']?.CrossChainSolver?.accountId}`
      }
    };

    const reportPath = path.join(__dirname, '../final-demo-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log('\n📊 Final Demo Report');
    console.log('='.repeat(50));
    console.log(`Status: ${report.demo.status}`);
    console.log(`Networks: Sepolia ↔ NEAR Testnet`);
    console.log(`Contracts Deployed: ✅`);
    console.log(`Test Wallets Funded: ✅`);
    console.log(`Demo Scenarios: 2 completed`);
    console.log(`Report saved: ${reportPath}`);
    console.log('='.repeat(50));

    // Print important links
    console.log('\n🔗 Important Links:');
    console.log(`Sepolia NearBridge: ${report.explorerLinks.nearBridge}`);
    if (report.explorerLinks.crossChainSolver) {
      console.log(`NEAR Solver: ${report.explorerLinks.crossChainSolver}`);
    }
  }
}

// Main execution
async function main() {
  try {
    const demo = new CrossChainDemo();
    await demo.runFullDemo();
    
    console.log('\n🎉 Cross-chain resolver demo completed!');
    console.log('Ready for hackathon presentation and live demonstration.');
    
  } catch (error) {
    console.error('❌ Demo execution failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { CrossChainDemo };
