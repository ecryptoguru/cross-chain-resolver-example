#!/usr/bin/env tsx

import { spawn } from 'child_process';
import { resolve } from 'path';

interface TestResult {
  testFile: string;
  passed: boolean;
  duration: number;
  output: string;
  error?: string;
}

class TestRunner {
  private testFiles = [
    'enhanced-monitor-relayer.test.ts',
    'enhanced-test-near-to-eth-transfer.test.ts',
    'enhanced-eth-to-near-transfer.test.ts'
  ];

  private results: TestResult[] = [];

  async runAllTests(): Promise<void> {
    console.log('🧪 Running Comprehensive Enhanced Scripts Test Suite');
    console.log('====================================================');
    console.log(`📋 Found ${this.testFiles.length} test files to execute\n`);

    for (const testFile of this.testFiles) {
      await this.runSingleTest(testFile);
    }

    this.printSummary();
  }

  private async runSingleTest(testFile: string): Promise<void> {
    console.log(`🔍 Running ${testFile}...`);
    const startTime = Date.now();

    try {
      const result = await this.executeTest(testFile);
      const duration = Date.now() - startTime;

      this.results.push({
        testFile,
        passed: result.exitCode === 0,
        duration,
        output: result.output,
        error: result.exitCode !== 0 ? result.output : undefined
      });

      if (result.exitCode === 0) {
        console.log(`✅ ${testFile} - PASSED (${duration}ms)`);
      } else {
        console.log(`❌ ${testFile} - FAILED (${duration}ms)`);
        console.log(`   Error: ${result.output.split('\n')[0]}`);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      console.log(`💥 ${testFile} - ERROR (${duration}ms)`);
      console.log(`   ${error}`);

      this.results.push({
        testFile,
        passed: false,
        duration,
        output: '',
        error: String(error)
      });
    }

    console.log(''); // Empty line for readability
  }

  private executeTest(testFile: string): Promise<{ exitCode: number; output: string }> {
    return new Promise((resolve, reject) => {
      const testPath = require('path').resolve(__dirname, testFile);
      const child = spawn('npx', ['tsx', '--test', testPath], {
        stdio: 'pipe',
        cwd: __dirname
      });

      let output = '';
      let errorOutput = '';

      if (child.stdout) {
        child.stdout.on('data', (data: any) => {
          output += data.toString();
        });
      }

      if (child.stderr) {
        child.stderr.on('data', (data: any) => {
          errorOutput += data.toString();
        });
      }

      child.on('close', (code: any) => {
        resolve({
          exitCode: code || 0,
          output: output + errorOutput
        });
      });

      child.on('error', (error: any) => {
        reject(error);
      });

      // Set timeout for long-running tests
      setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('Test timeout after 30 seconds'));
      }, 30000);
    });
  }

  // Public wrapper for runSingleTest to be used by individual test runners
  async runSingleTestPublic(testFile: string): Promise<void> {
    await this.runSingleTest(testFile);
  }

  private printSummary(): void {
    const totalTests = this.results.length;
    const passedTests = this.results.filter(r => r.passed).length;
    const failedTests = totalTests - passedTests;
    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);

    console.log('📊 TEST SUMMARY');
    console.log('================');
    console.log(`Total Tests:    ${totalTests}`);
    console.log(`Passed:         ${passedTests} ✅`);
    console.log(`Failed:         ${failedTests} ${failedTests > 0 ? '❌' : ''}`);
    console.log(`Total Duration: ${totalDuration}ms`);
    console.log(`Success Rate:   ${((passedTests / totalTests) * 100).toFixed(1)}%`);

    if (failedTests > 0) {
      console.log('\n❌ FAILED TESTS:');
      this.results
        .filter(r => !r.passed)
        .forEach(result => {
          console.log(`   • ${result.testFile}`);
          if (result.error) {
            console.log(`     ${result.error.split('\n')[0]}`);
          }
        });
    }

    console.log('\n📋 DETAILED RESULTS:');
    this.results.forEach(result => {
      const status = result.passed ? '✅ PASS' : '❌ FAIL';
      console.log(`   ${status} ${result.testFile} (${result.duration}ms)`);
    });

    if (failedTests === 0) {
      console.log('\n🎉 All tests passed! Enhanced scripts are ready for production.');
    } else {
      console.log(`\n⚠️  ${failedTests} test(s) failed. Please review and fix issues.`);
      process.exit(1);
    }
  }
}

// Individual test runners for specific test files
export async function runMonitorRelayerTests(): Promise<void> {
  console.log('🧪 Running Enhanced Monitor Relayer Tests');
  const runner = new TestRunner();
  await runner.runSingleTestPublic('enhanced-monitor-relayer.test.ts');
}

export async function runNearToEthTests(): Promise<void> {
  console.log('🧪 Running Enhanced NEAR-to-ETH Transfer Tests');
  const runner = new TestRunner();
  await runner.runSingleTestPublic('enhanced-test-near-to-eth-transfer.test.ts');
}

export async function runEthToNearTests(): Promise<void> {
  console.log('🧪 Running Enhanced ETH-to-NEAR Transfer Tests');
  const runner = new TestRunner();
  await runner.runSingleTestPublic('enhanced-eth-to-near-transfer.test.ts');
}

// Main execution
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    // Run all tests
    const runner = new TestRunner();
    await runner.runAllTests();
  } else {
    // Run specific test
    const testName = args[0];
    switch (testName) {
      case 'monitor':
        await runMonitorRelayerTests();
        break;
      case 'near-to-eth':
        await runNearToEthTests();
        break;
      case 'eth-to-near':
        await runEthToNearTests();
        break;
      default:
        console.error(`❌ Unknown test: ${testName}`);
        console.log('Available tests: monitor, near-to-eth, eth-to-near');
        process.exit(1);
    }
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Test runner failed:', error);
    process.exit(1);
  });
}
