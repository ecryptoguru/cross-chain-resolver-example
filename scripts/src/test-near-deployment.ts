#!/usr/bin/env ts-node

import { execSync } from 'child_process';
import * as path from 'path';

class NearDeploymentTest {
    private contractPath: string;
    private accountId: string;

    constructor() {
        this.contractPath = path.resolve(__dirname, '../../near-contracts/escrow');
        this.accountId = `escrow-test-${Date.now()}.testnet`;
    }

    async testDeployment(): Promise<void> {
        console.log('🧪 Testing NEAR Contract Deployment');
        console.log('=====================================');
        console.log(`📋 Test Account: ${this.accountId}`);
        console.log(`📁 Contract Path: ${this.contractPath}`);
        
        try {
            // Step 1: Verify WASM exists
            console.log('\n📦 Verifying WASM build...');
            const wasmPath = path.join(this.contractPath, 'target/wasm32-unknown-unknown/release/escrow.wasm');
            execSync(`ls -la "${wasmPath}"`, { stdio: 'inherit' });
            
            // Step 2: Create test account
            console.log('\n👤 Creating test account...');
            execSync(`near create-account ${this.accountId} --masterAccount testnet --initialBalance 5`, {
                stdio: 'inherit',
                cwd: this.contractPath
            });
            
            // Step 3: Deploy contract
            console.log('\n🚀 Deploying contract...');
            execSync(`near deploy ${this.accountId} "${wasmPath}"`, {
                stdio: 'inherit',
                cwd: this.contractPath
            });
            
            // Step 4: Initialize contract
            console.log('\n⚡ Initializing contract...');
            execSync(`near call ${this.accountId} new '{"owner_id":"${this.accountId}"}' --accountId ${this.accountId}`, {
                stdio: 'inherit',
                cwd: this.contractPath
            });
            
            // Step 5: Test basic functionality
            console.log('\n🔍 Testing basic functionality...');
            execSync(`near call ${this.accountId} ping '{}' --accountId ${this.accountId}`, {
                stdio: 'inherit',
                cwd: this.contractPath
            });
            
            execSync(`near call ${this.accountId} get_owner '{}' --accountId ${this.accountId}`, {
                stdio: 'inherit',
                cwd: this.contractPath
            });
            
            console.log('\n✅ NEAR Contract Deployment Test SUCCESSFUL!');
            console.log('🎉 WASM deserialization error has been RESOLVED!');
            
        } catch (error) {
            console.error('\n❌ NEAR Contract Deployment Test FAILED!');
            console.error('Error:', error);
            
            if (error && typeof error === 'object' && 'toString' in error) {
                if (error.toString().includes('PrepareError::Deserialization')) {
                    console.error('🔴 WASM deserialization error still persists');
                }
            }
            
            throw error;
        }
    }
}

async function main() {
    const test = new NearDeploymentTest();
    await test.testDeployment();
}

if (require.main === module) {
    main().catch(console.error);
}
