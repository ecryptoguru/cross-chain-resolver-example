#!/usr/bin/env ts-node

import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { getConfig, getProvider, getSigner } from './config';

interface TestnetConfig {
  networks: any;
  contracts: any;
  testWallets: any;
  tokens: any;
  relayer: any;
}

interface DeploymentResult {
  address: string;
  txHash: string;
  deployedAt: string;
}

class TestnetDeployer {
  private config: TestnetConfig;
  private provider: ethers.JsonRpcProvider;
  private signer: ethers.Wallet;
  private networkConfig: any;

  constructor() {
    // Load testnet configuration
    const configPath = path.join(__dirname, '../testnet-config.json');
    this.config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    // Get network configuration
    this.networkConfig = getConfig();
    this.provider = getProvider(this.networkConfig.rpcUrl);
    this.signer = getSigner(this.networkConfig.privateKey, this.provider);
  }

  async deployContracts(): Promise<void> {
    console.log('🚀 Starting testnet deployment...');
    console.log(`Network: Sepolia (Chain ID: ${this.networkConfig.chainId})`);
    console.log(`Deployer: ${this.signer.address}`);

    // Check deployer balance
    const balance = await this.provider.getBalance(this.signer.address);
    console.log(`Deployer balance: ${ethers.formatEther(balance)} ETH`);

    if (balance < ethers.parseEther('0.1')) {
      throw new Error('Insufficient balance for deployment. Need at least 0.1 ETH');
    }

    // Deploy contracts in order (FeeToken first, then NearBridge)
    await this.deployFeeToken();
    await this.deployNearBridge();
    await this.deployTestEscrowFactory();
    
    // Update configuration with deployed addresses
    await this.updateConfig();
    
    console.log('✅ All contracts deployed successfully!');
  }

  private async deployNearBridge(): Promise<DeploymentResult> {
    console.log('\n📦 Deploying NearBridge contract...');
    
    // Load contract artifacts
    const artifactPath = path.join(__dirname, '../../contracts/out/NearBridge.sol/NearBridge.json');
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    
    // Constructor parameters for NearBridge
    const owner = this.signer.address;
    const feeToken = this.config.contracts.sepolia.FeeToken.address; // Use deployed FeeToken
    const accessToken = ethers.ZeroAddress; // No access token required
    const feeCollector = this.signer.address;
    const minDeposit = ethers.parseEther('0.001'); // 0.001 ETH minimum
    const maxDeposit = ethers.parseEther('100'); // 100 ETH maximum
    const disputePeriod = 86400; // 24 hours in seconds
    const bridgeFeeBps = 30; // 0.3% fee (30 basis points)
    const initialStatus = 0; // BridgeStatus.ACTIVE
    
    // Deploy contract
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, this.signer);
    const contract = await factory.deploy(
      owner,
      feeToken,
      accessToken,
      feeCollector,
      minDeposit,
      maxDeposit,
      disputePeriod,
      bridgeFeeBps,
      initialStatus
    );
    await contract.waitForDeployment();
    
    const address = await contract.getAddress();
    const deploymentTx = contract.deploymentTransaction();
    
    console.log(`✅ NearBridge deployed at: ${address}`);
    console.log(`📄 Transaction: ${deploymentTx?.hash}`);
    
    // Update config
    this.config.contracts.sepolia.NearBridge = {
      address,
      deployedAt: new Date().toISOString(),
      txHash: deploymentTx?.hash
    };
    
    return {
      address,
      txHash: deploymentTx?.hash || '',
      deployedAt: new Date().toISOString()
    };
  }

  private async deployTestEscrowFactory(): Promise<DeploymentResult> {
    console.log('\n📦 Deploying TestEscrowFactory contract...');
    
    const artifactPath = path.join(__dirname, '../../contracts/out/TestEscrowFactory.sol/TestEscrowFactory.json');
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    
    // Constructor parameters for TestEscrowFactory
    const limitOrderProtocol = ethers.ZeroAddress; // Mock address for testing
    const feeToken = this.config.contracts.sepolia.FeeToken.address; // Use deployed FeeToken
    const accessToken = ethers.ZeroAddress; // No access token required
    const owner = this.signer.address;
    const rescueDelaySrc = 86400; // 24 hours in seconds
    const rescueDelayDst = 86400; // 24 hours in seconds
    
    // Deploy contract
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, this.signer);
    const contract = await factory.deploy(
      limitOrderProtocol,
      feeToken,
      accessToken,
      owner,
      rescueDelaySrc,
      rescueDelayDst
    );
    await contract.waitForDeployment();
    
    const address = await contract.getAddress();
    const deploymentTx = contract.deploymentTransaction();
    
    console.log(`✅ TestEscrowFactory deployed at: ${address}`);
    console.log(`📄 Transaction: ${deploymentTx?.hash}`);
    
    // Update config
    this.config.contracts.sepolia.TestEscrowFactory = {
      address,
      txHash: deploymentTx?.hash || '',
      deployedAt: new Date().toISOString()
    };
    
    return {
      address,
      txHash: deploymentTx?.hash || '',
      deployedAt: new Date().toISOString()
    };
  }

  private async deployFeeToken(): Promise<DeploymentResult> {
    console.log('\n📦 Deploying FeeToken contract...');
    
    // Load contract artifacts
    const artifactPath = path.join(__dirname, '../../contracts/out/FeeToken.sol/FeeToken.json');
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    
    // Constructor parameters
    const name = 'Test Fee Token';
    const symbol = 'TFT';
    const initialSupply = ethers.parseEther('1000000'); // 1M tokens
    
    // Deploy contract
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, this.signer);
    const contract = await factory.deploy(name, symbol, initialSupply);
    await contract.waitForDeployment();
    
    const address = await contract.getAddress();
    const deploymentTx = contract.deploymentTransaction();
    
    console.log(`✅ FeeToken deployed at: ${address}`);
    console.log(`📄 Transaction: ${deploymentTx?.hash}`);
    
    // Update config
    this.config.contracts.sepolia.FeeToken = {
      address,
      deployedAt: new Date().toISOString(),
      txHash: deploymentTx?.hash
    };
    
    return {
      address,
      txHash: deploymentTx?.hash || '',
      deployedAt: new Date().toISOString()
    };
  }

  async fundTestWallets(): Promise<void> {
    console.log('\n💰 Funding test wallets...');
    
    // Generate test wallets if they don't exist
    await this.generateTestWallets();
    
    // Fund each test wallet with ETH
    const fundingAmount = ethers.parseEther('0.1'); // 0.1 ETH per wallet
    
    for (const [name, wallet] of Object.entries(this.config.testWallets.ethereum)) {
      if (name === 'deployer') continue; // Skip deployer
      
      const walletData = wallet as any;
      if (walletData.address) {
        console.log(`Funding ${name}: ${walletData.address}`);
        
        const tx = await this.signer.sendTransaction({
          to: walletData.address,
          value: fundingAmount
        });
        
        await tx.wait();
        console.log(`✅ Funded ${name} with 0.1 ETH - TX: ${tx.hash}`);
        
        // Update balance
        const balance = await this.provider.getBalance(walletData.address);
        walletData.balance = ethers.formatEther(balance);
      }
    }
  }

  private async generateTestWallets(): Promise<void> {
    console.log('\n🔑 Generating test wallets...');
    
    // Generate Ethereum test wallets
    for (const [name, wallet] of Object.entries(this.config.testWallets.ethereum)) {
      const walletData = wallet as any;
      if (!walletData.address && name !== 'deployer') {
        const testWallet = ethers.Wallet.createRandom();
        walletData.address = testWallet.address;
        walletData.privateKey = testWallet.privateKey;
        console.log(`Generated ${name}: ${testWallet.address}`);
      } else if (name === 'deployer') {
        walletData.address = this.signer.address;
        const balance = await this.provider.getBalance(this.signer.address);
        walletData.balance = ethers.formatEther(balance);
      }
    }
  }

  async setupCrossChainConfig(): Promise<void> {
    console.log('\n🌉 Setting up cross-chain configuration...');
    
    // Create relayer configuration
    const relayerConfig = {
      ethereum: {
        rpcUrl: this.networkConfig.rpcUrl,
        contracts: {
          nearBridge: this.config.contracts.sepolia.NearBridge.address
        },
        privateKey: this.networkConfig.privateKey,
        ...this.config.relayer.ethereum
      },
      near: {
        rpcUrl: this.config.networks['near-testnet'].rpcUrl,
        contracts: {
          crossChainSolver: this.config.contracts['near-testnet'].CrossChainSolver.accountId || 'solver.testnet'
        },
        ...this.config.relayer.near
      }
    };
    
    // Save relayer configuration
    const relayerConfigPath = path.join(__dirname, '../relayer-config.json');
    fs.writeFileSync(relayerConfigPath, JSON.stringify(relayerConfig, null, 2));
    console.log(`✅ Relayer config saved to: ${relayerConfigPath}`);
    
    // Create demo scenarios configuration
    const demoConfig = {
      scenarios: [
        {
          name: 'ETH to NEAR Swap',
          description: 'Swap ETH on Sepolia for NEAR on testnet',
          sourceChain: 'sepolia',
          targetChain: 'near-testnet',
          sourceToken: 'ETH',
          targetToken: 'NEAR',
          amount: '0.01',
          estimatedTime: '5 minutes'
        },
        {
          name: 'NEAR to ETH Swap',
          description: 'Swap NEAR on testnet for ETH on Sepolia',
          sourceChain: 'near-testnet',
          targetChain: 'sepolia',
          sourceToken: 'NEAR',
          targetToken: 'ETH',
          amount: '10',
          estimatedTime: '5 minutes'
        }
      ],
      testWallets: this.config.testWallets,
      contracts: this.config.contracts
    };
    
    const demoConfigPath = path.join(__dirname, '../demo-config.json');
    fs.writeFileSync(demoConfigPath, JSON.stringify(demoConfig, null, 2));
    console.log(`✅ Demo config saved to: ${demoConfigPath}`);
  }

  private async updateConfig(): Promise<void> {
    // Save updated configuration
    const configPath = path.join(__dirname, '../testnet-config.json');
    fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2));
    console.log(`✅ Configuration updated: ${configPath}`);
  }

  async generateDeploymentReport(): Promise<void> {
    console.log('\n📊 Generating deployment report...');
    
    const report = {
      deployment: {
        network: 'Sepolia Testnet',
        chainId: this.networkConfig.chainId,
        deployer: this.signer.address,
        timestamp: new Date().toISOString()
      },
      contracts: this.config.contracts.sepolia,
      testWallets: this.config.testWallets.ethereum,
      explorerLinks: {
        nearBridge: `${this.config.networks.sepolia.explorerUrl}/address/${this.config.contracts.sepolia.NearBridge.address}`,
        testEscrowFactory: `${this.config.networks.sepolia.explorerUrl}/address/${this.config.contracts.sepolia.TestEscrowFactory.address}`,
        feeToken: `${this.config.networks.sepolia.explorerUrl}/address/${this.config.contracts.sepolia.FeeToken.address}`
      },
      nextSteps: [
        'Deploy NEAR contracts to testnet',
        'Start relayer service',
        'Run cross-chain swap demo',
        'Verify transaction flows'
      ]
    };
    
    const reportPath = path.join(__dirname, '../deployment-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`✅ Deployment report saved to: ${reportPath}`);
    
    // Print summary
    console.log('\n🎉 Deployment Summary:');
    console.log('='.repeat(50));
    console.log(`Network: ${report.deployment.network}`);
    console.log(`Deployer: ${report.deployment.deployer}`);
    console.log(`NearBridge: ${this.config.contracts.sepolia.NearBridge.address}`);
    console.log(`TestEscrowFactory: ${this.config.contracts.sepolia.TestEscrowFactory.address}`);
    console.log(`FeeToken: ${this.config.contracts.sepolia.FeeToken.address}`);
    console.log('='.repeat(50));
  }
}

// Main execution
async function main() {
  try {
    const deployer = new TestnetDeployer();
    
    // Deploy contracts
    await deployer.deployContracts();
    
    // Fund test wallets
    await deployer.fundTestWallets();
    
    // Setup cross-chain configuration
    await deployer.setupCrossChainConfig();
    
    // Generate deployment report
    await deployer.generateDeploymentReport();
    
    console.log('\n🎉 Testnet deployment completed successfully!');
    console.log('Next: Deploy NEAR contracts and start relayer service');
    
  } catch (error) {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { TestnetDeployer };
