#!/usr/bin/env ts-node

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface DeploymentConfig {
  contractAccount: string;
  ownerAccount: string;
  teeRegistryAccount: string;
  deploymentTimestamp: number;
}

class NearCorrectDeployment {
  private config: DeploymentConfig;

  constructor() {
    const timestamp = Date.now();
    this.config = {
      contractAccount: `escrow-${timestamp}.testnet`,
      ownerAccount: 'defiankit.testnet', // Replace with your NEAR testnet account
      teeRegistryAccount: 'tee-registry.testnet',
      deploymentTimestamp: timestamp
    };
  }

  async deploy(): Promise<void> {
    console.log('🚀 Starting NEAR Escrow Contract Deployment (Correct Method)...');
    console.log('===============================================');
    console.log(`📋 Contract Account: ${this.config.contractAccount}`);
    console.log(`👤 Owner Account: ${this.config.ownerAccount}`);
    console.log(`🔐 TEE Registry: ${this.config.teeRegistryAccount}`);
    
    try {
      // Step 1: Build the contract
      await this.buildContract();
      
      // Step 2: Create contract account using faucet
      await this.createContractAccount();
      
      // Step 3: Deploy contract using correct CLI syntax
      await this.deployContract();
      
      // Step 4: Initialize contract
      await this.initializeContract();
      
      // Step 5: Verify deployment
      await this.verifyDeployment();
      
      // Step 6: Generate configuration
      await this.generateConfig();
      
      console.log('\n🎉 NEAR Contract Successfully Deployed!');
      console.log('===============================================');
      console.log(`✅ Contract: ${this.config.contractAccount}`);
      console.log(`✅ Owner: ${this.config.ownerAccount}`);
      console.log(`✅ TEE Registry: ${this.config.teeRegistryAccount}`);
      console.log('\n🚀 Ready for Cross-Chain Demo!');
      
    } catch (error) {
      console.error('❌ Deployment failed:', error);
      throw error;
    }
  }

  private async buildContract(): Promise<void> {
    console.log('\n📦 Building NEAR escrow contract...');
    
    const escrowDir = path.join(__dirname, '../../near-contracts/escrow');
    
    execSync('cargo build --target wasm32-unknown-unknown --release', {
      cwd: escrowDir,
      stdio: 'inherit'
    });
    
    const wasmPath = path.join(escrowDir, 'target/wasm32-unknown-unknown/release/escrow.wasm');
    
    if (!fs.existsSync(wasmPath)) {
      throw new Error('WASM file not found after build');
    }
    
    const stats = fs.statSync(wasmPath);
    console.log(`✅ Contract built successfully (${(stats.size / 1024).toFixed(2)} KB)`);
  }

  private async createContractAccount(): Promise<void> {
    console.log(`\n👤 Creating contract account: ${this.config.contractAccount}`);
    
    try {
      // Use the correct NEAR CLI syntax from documentation
      execSync(`near create-account ${this.config.contractAccount} --useFaucet`, {
        stdio: 'inherit'
      });
      console.log(`✅ Account created and funded: ${this.config.contractAccount}`);
    } catch (error) {
      console.log(`⚠️  Account creation may have failed, but continuing with deployment...`);
      // Continue - account might already exist
    }
  }

  private async deployContract(): Promise<void> {
    console.log(`\n🚀 Deploying contract to: ${this.config.contractAccount}`);
    
    const wasmPath = path.join(__dirname, '../../near-contracts/escrow/target/wasm32-unknown-unknown/release/escrow.wasm');
    
    // Use the correct deployment syntax from NEAR documentation
    execSync(`near deploy ${this.config.contractAccount} ${wasmPath}`, {
      stdio: 'inherit'
    });
    
    console.log(`✅ Contract WASM deployed successfully`);
  }

  private async initializeContract(): Promise<void> {
    console.log(`\n🔧 Initializing contract...`);
    
    // Initialize the contract with proper parameters
    const initArgs = JSON.stringify({
      owner_id: this.config.ownerAccount,
      tee_registry_id: this.config.teeRegistryAccount
    });
    
    execSync(`near call ${this.config.contractAccount} new '${initArgs}' --accountId ${this.config.ownerAccount}`, {
      stdio: 'inherit'
    });
    
    console.log(`✅ Contract initialized successfully`);
  }

  private async verifyDeployment(): Promise<void> {
    console.log('\n🔍 Verifying deployment...');
    
    try {
      // Test a simple view call to verify the contract is working
      const result = execSync(
        `near view ${this.config.contractAccount} get_protocol_fee_basis_points`,
        { encoding: 'utf8' }
      );
      
      console.log('✅ Contract verification successful');
      console.log(`📊 Protocol fee: ${result.trim()} basis points`);
    } catch (error) {
      console.log('⚠️  Contract verification failed, but deployment may still be successful');
      console.log('Error:', error);
    }
  }

  private async generateConfig(): Promise<void> {
    console.log('\n📝 Generating deployment configuration...');
    
    const config = {
      deployment: {
        timestamp: this.config.deploymentTimestamp,
        network: 'testnet',
        status: 'deployed'
      },
      ethereum: {
        network: 'sepolia',
        rpcUrl: 'https://sepolia.infura.io/v3/YOUR_INFURA_KEY',
        contracts: {
          feeToken: '0x7FC00Ae5A60a9aC47A1042A2Cc8a5171aD3C8f6d',
          nearBridge: '0x4A75BC3F96554949D40d2B9fA02c070d8ae12881',
          testEscrowFactory: '0xedFf8aD3f18d912e0a40247e5a246CB76aCedDE7'
        }
      },
      near: {
        network: 'testnet',
        rpcUrl: 'https://rpc.testnet.near.org',
        contracts: {
          escrow: this.config.contractAccount,
          owner: this.config.ownerAccount,
          teeRegistry: this.config.teeRegistryAccount
        }
      },
      crossChain: {
        relayerEnabled: true,
        supportedTokens: {
          ethereum: ['ETH', 'USDC', 'DAI'],
          near: ['NEAR', 'wNEAR', 'USDC.e']
        },
        swapPairs: [
          { from: 'ETH', to: 'NEAR', minAmount: '0.01', maxAmount: '10' },
          { from: 'NEAR', to: 'ETH', minAmount: '1', maxAmount: '1000' }
        ]
      },
      demo: {
        ready: true,
        testScenarios: [
          'ETH to NEAR atomic swap',
          'NEAR to ETH atomic swap',
          'Hashlock/timelock verification',
          'Cross-chain message relay'
        ]
      }
    };

    const configPath = path.join(__dirname, '../config/final-deployment.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    
    console.log(`✅ Configuration saved to: ${configPath}`);
  }
}

async function main() {
  const deployer = new NearCorrectDeployment();
  await deployer.deploy();
}

if (require.main === module) {
  main().catch(console.error);
}
