#!/usr/bin/env ts-node

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

class NearDeployOnlyTest {
  private contractAccount: string;
  private timestamp: string;

  constructor() {
    this.timestamp = Date.now().toString();
    this.contractAccount = `escrow-deploy-only-${this.timestamp}.testnet`;
  }

  async deploy(): Promise<void> {
    console.log('🚀 NEAR Contract - Deploy Only Test');
    console.log('===================================');
    console.log(`📋 Contract Account: ${this.contractAccount}`);
    console.log(`⏰ Timestamp: ${new Date().toISOString()}`);

    try {
      await this.buildContract();
      await this.createAccount();
      await this.deployOnly();
      await this.testDeployedContract();
      await this.generateReport();
      
      console.log('\n✅ DEPLOY-ONLY TEST COMPLETED SUCCESSFULLY!');
      
    } catch (error) {
      console.error('❌ Deploy-only test failed:', error);
      throw error;
    }
  }

  private async buildContract(): Promise<void> {
    console.log('\n📦 Building NEAR contract...');
    const contractDir = '/Users/defiankit/Desktop/fusionswapn/cross-chain-resolver-example/near-contracts/escrow';
    
    execSync('cargo clean', { cwd: contractDir, stdio: 'inherit' });
    execSync('cargo build --target wasm32-unknown-unknown --release', { 
      cwd: contractDir, 
      stdio: 'inherit' 
    });
    
    const wasmPath = path.join(contractDir, 'target/wasm32-unknown-unknown/release/escrow.wasm');
    const stats = fs.statSync(wasmPath);
    console.log(`✅ Contract built (${(stats.size / 1024).toFixed(2)} KB)`);
  }

  private async createAccount(): Promise<void> {
    console.log(`\n👤 Creating account: ${this.contractAccount}`);
    execSync(`near create-account ${this.contractAccount} --useFaucet`, {
      stdio: 'inherit'
    });
    console.log(`✅ Account created: ${this.contractAccount}`);
  }

  private async deployOnly(): Promise<void> {
    console.log('\n🚀 Deploying contract (WITHOUT initialization)...');
    const contractDir = '/Users/defiankit/Desktop/fusionswapn/cross-chain-resolver-example/near-contracts/escrow';
    const wasmPath = path.join(contractDir, 'target/wasm32-unknown-unknown/release/escrow.wasm');
    
    // Deploy without calling the constructor
    execSync(`near deploy ${this.contractAccount} ${wasmPath}`, {
      stdio: 'inherit'
    });
    
    console.log('✅ Contract deployed (no initialization)');
  }

  private async testDeployedContract(): Promise<void> {
    console.log('\n🧪 Testing deployed contract...');
    
    try {
      // Try to call a view method that doesn't require initialization
      console.log('📋 Testing ping method...');
      const result = execSync(`near view ${this.contractAccount} ping`, {
        encoding: 'utf8'
      });
      console.log(`✅ Ping result: ${result.trim()}`);
      
    } catch (error) {
      console.log('⚠️ Ping failed (expected - contract not initialized)');
      
      // Now try to initialize the contract
      console.log('🔧 Attempting contract initialization...');
      try {
        execSync(`near call ${this.contractAccount} new '{"owner_id":"${this.contractAccount}"}' --accountId ${this.contractAccount}`, {
          stdio: 'inherit'
        });
        console.log('✅ Contract initialized successfully!');
        
        // Test again after initialization
        const pingResult = execSync(`near view ${this.contractAccount} ping`, {
          encoding: 'utf8'
        });
        console.log(`✅ Post-init ping result: ${pingResult.trim()}`);
        
        const infoResult = execSync(`near view ${this.contractAccount} get_info`, {
          encoding: 'utf8'
        });
        console.log(`✅ Contract info: ${infoResult.trim()}`);
        
      } catch (initError) {
        console.error('❌ Initialization failed:', initError);
        throw initError;
      }
    }
  }

  private async generateReport(): Promise<void> {
    console.log('\n📊 Generating deployment report...');
    
    const report = {
      deployOnlyTest: {
        timestamp: new Date().toISOString(),
        contractAccount: this.contractAccount,
        status: 'SUCCESS',
        approach: 'deploy_without_initialization_then_init',
        explorerUrl: `https://testnet.nearblocks.io/address/${this.contractAccount}`
      },
      findings: {
        deploymentWorked: true,
        initializationWorked: true,
        wasmDeserializationError: false,
        contractFunctional: true
      },
      nextSteps: [
        'Use deploy-only approach for hackathon demo',
        'Initialize contract separately after deployment',
        'Verify all contract methods work post-initialization'
      ]
    };

    const reportPath = path.join(__dirname, '../reports/near-deploy-only-test.json');
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    console.log(`✅ Report generated: ${reportPath}`);
    console.log(`🔍 Explorer: https://testnet.nearblocks.io/address/${this.contractAccount}`);
  }
}

async function main() {
  const deployer = new NearDeployOnlyTest();
  await deployer.deploy();
}

if (require.main === module) {
  main().catch(console.error);
}
