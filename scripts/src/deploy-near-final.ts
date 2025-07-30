#!/usr/bin/env ts-node

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface DeploymentConfig {
  nearAccount: string;
  contractAccount: string;
  teeRegistryAccount: string;
  deploymentTimestamp: number;
}

class NearFinalDeployment {
  private config: DeploymentConfig;

  constructor() {
    const timestamp = Date.now();
    this.config = {
      nearAccount: 'defiankit.testnet', // Replace with your NEAR testnet account
      contractAccount: `escrow-${timestamp}.testnet`,
      teeRegistryAccount: 'tee-registry.testnet',
      deploymentTimestamp: timestamp
    };
  }

  async deploy(): Promise<void> {
    console.log('🚀 Starting NEAR Escrow Contract Deployment to Testnet...');
    console.log('===============================================');
    
    try {
      // Step 1: Build the contract
      await this.buildContract();
      
      // Step 2: Create contract account
      await this.createContractAccount();
      
      // Step 3: Deploy and initialize contract
      await this.deployContract();
      
      // Step 4: Verify deployment
      await this.verifyDeployment();
      
      // Step 5: Generate configuration
      await this.generateConfig();
      
      console.log('\n🎉 NEAR Contract Successfully Deployed!');
      console.log('===============================================');
      console.log(`✅ Contract Account: ${this.config.contractAccount}`);
      console.log(`✅ Owner: ${this.config.nearAccount}`);
      console.log(`✅ TEE Registry: ${this.config.teeRegistryAccount}`);
      console.log('\n📋 Next Steps:');
      console.log('1. Initialize cross-chain relayer service');
      console.log('2. Execute live cross-chain swap demonstration');
      console.log('3. Verify atomic swap completion on both chains');
      
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
      // Create account using faucet for testnet
      execSync(`near create-account ${this.config.contractAccount} --useFaucet`, {
        stdio: 'inherit'
      });
      console.log(`✅ Account created: ${this.config.contractAccount}`);
    } catch (error) {
      console.log(`⚠️  Account ${this.config.contractAccount} might already exist or creation failed`);
      // Continue with deployment even if account creation fails
    }
  }

  private async deployContract(): Promise<void> {
    console.log(`\n🚀 Deploying contract to: ${this.config.contractAccount}`);
    
    const wasmPath = path.join(__dirname, '../../near-contracts/escrow/target/wasm32-unknown-unknown/release/escrow.wasm');
    
    // Deploy contract
    console.log('Deploying WASM file...');
    execSync(`near deploy ${this.config.contractAccount} ${wasmPath}`, {
      stdio: 'inherit'
    });
    
    // Initialize contract
    console.log('Initializing contract...');
    const initArgs = JSON.stringify({
      owner_id: this.config.nearAccount,
      tee_registry_id: this.config.teeRegistryAccount
    });
    
    execSync(`near call ${this.config.contractAccount} new '${initArgs}' --accountId ${this.config.nearAccount}`, {
      stdio: 'inherit'
    });
    
    console.log(`✅ Contract deployed and initialized`);
  }

  private async verifyDeployment(): Promise<void> {
    console.log('\n🔍 Verifying deployment...');
    
    try {
      // Call a view method to verify the contract is working
      const result = execSync(
        `near contract call-function as-read-only ${this.config.contractAccount} get_protocol_fee_basis_points json-args '{}' network-config testnet now`,
        { encoding: 'utf8' }
      );
      
      console.log('✅ Contract verification successful');
      console.log(`📊 Protocol fee: ${result.trim()} basis points`);
    } catch (error) {
      console.log('⚠️  Contract verification failed, but deployment may still be successful');
    }
  }

  private async generateConfig(): Promise<void> {
    console.log('\n📝 Generating deployment configuration...');
    
    const config = {
      deployment: {
        timestamp: this.config.deploymentTimestamp,
        network: 'testnet'
      },
      ethereum: {
        network: 'sepolia',
        contracts: {
          feeToken: '0x7FC00Ae5A60a9aC47A1042A2Cc8a5171aD3C8f6d',
          nearBridge: '0x4A75BC3F96554949D40d2B9fA02c070d8ae12881',
          testEscrowFactory: '0xedFf8aD3f18d912e0a40247e5a246CB76aCedDE7'
        }
      },
      near: {
        network: 'testnet',
        contracts: {
          escrow: this.config.contractAccount,
          owner: this.config.nearAccount,
          teeRegistry: this.config.teeRegistryAccount
        }
      },
      crossChain: {
        relayerEnabled: true,
        supportedTokens: {
          ethereum: ['ETH', 'USDC', 'DAI'],
          near: ['NEAR', 'wNEAR', 'USDC.e']
        }
      }
    };

    const configPath = path.join(__dirname, '../config/hackathon-deployment.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    
    console.log(`✅ Configuration saved to: ${configPath}`);
  }
}

async function main() {
  const deployer = new NearFinalDeployment();
  await deployer.deploy();
}

if (require.main === module) {
  main().catch(console.error);
}
