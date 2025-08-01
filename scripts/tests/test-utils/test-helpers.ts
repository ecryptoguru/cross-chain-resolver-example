// Test helper utilities for enhanced scripts testing

import { strict as assert } from 'assert';

export class TestHelpers {
  static async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static createMockTransactionReceipt(options: {
    hash?: string;
    blockNumber?: number;
    gasUsed?: bigint;
    status?: number;
    logs?: any[];
  } = {}) {
    return {
      hash: options.hash || '0x' + '1'.repeat(64),
      blockNumber: options.blockNumber || 1000000,
      gasUsed: options.gasUsed || BigInt(21000),
      status: options.status || 1,
      logs: options.logs || [],
      wait: async () => ({
        hash: options.hash || '0x' + '1'.repeat(64),
        blockNumber: options.blockNumber || 1000000,
        gasUsed: options.gasUsed || BigInt(21000),
        status: options.status || 1,
        logs: options.logs || []
      })
    };
  }

  static createMockTransaction(options: {
    hash?: string;
    wait?: () => Promise<any>;
  } = {}) {
    return {
      hash: options.hash || '0x' + '1'.repeat(64),
      wait: options.wait || (() => Promise.resolve(TestHelpers.createMockTransactionReceipt()))
    };
  }

  static createMockDepositEvent() {
    return {
      depositId: '0x' + '1'.repeat(64),
      sender: '0x' + '2'.repeat(40),
      nearRecipient: 'test.testnet',
      token: '0x' + '0'.repeat(40),
      amount: BigInt('10000000000000000'), // 0.01 ETH
      fee: BigInt('1000000000000000'),    // 0.001 ETH
      timestamp: BigInt(Date.now())
    };
  }

  static createMockMessageSentEvent() {
    return {
      messageId: '0x' + '2'.repeat(64),
      depositId: '0x' + '1'.repeat(64),
      sender: '0x' + '2'.repeat(40),
      recipient: 'test.testnet',
      amount: BigInt('10000000000000000'),
      timestamp: BigInt(Date.now())
    };
  }

  static createMockWithdrawalEvent() {
    return {
      depositId: '0x' + '1'.repeat(64),
      recipient: '0x' + '3'.repeat(40),
      amount: BigInt('10000000000000000'),
      timestamp: BigInt(Date.now())
    };
  }

  static createMockNearBlock(height: number = 1000000) {
    return {
      result: {
        header: {
          height,
          timestamp: Date.now() * 1000000 // NEAR uses nanoseconds
        }
      }
    };
  }

  static createMockNearEscrowData() {
    return {
      orderId: 'test-order-' + Date.now(),
      amount: '10000000000000000000000', // 0.01 NEAR in yoctoNEAR
      recipient: '0x' + '3'.repeat(40),
      hashlock: '0x' + '4'.repeat(64),
      timelock: Date.now() + 3600000, // 1 hour from now
      status: 'created',
      created_at: Date.now()
    };
  }

  static assertError(error: any, expectedType: string, expectedMessage?: string) {
    assert(error instanceof Error, 'Expected an Error object');
    assert.equal(error.name, expectedType, `Expected error type ${expectedType}`);
    if (expectedMessage) {
      assert(error.message.includes(expectedMessage), 
        `Expected error message to contain "${expectedMessage}", got "${error.message}"`);
    }
  }

  static assertValidConfig(config: any, requiredFields: string[]) {
    for (const field of requiredFields) {
      assert(config.hasOwnProperty(field), `Config missing required field: ${field}`);
      assert(config[field] !== undefined && config[field] !== null, 
        `Config field ${field} is undefined or null`);
    }
  }

  static assertValidTestResult(result: any) {
    assert(typeof result === 'object', 'Result should be an object');
    assert(typeof result.success === 'boolean', 'Result should have success boolean');
    assert(typeof result.duration === 'number', 'Result should have duration number');
    
    if (result.success) {
      // Success results should have additional fields
      assert(result.error === undefined, 'Success result should not have error');
    } else {
      // Failed results should have error message
      assert(typeof result.error === 'string', 'Failed result should have error string');
    }
  }

  static createMockLogger() {
    const logs: { level: string; message: string; meta?: any }[] = [];
    
    return {
      logs,
      info: (message: string, meta?: any) => logs.push({ level: 'info', message, meta }),
      warn: (message: string, meta?: any) => logs.push({ level: 'warn', message, meta }),
      error: (message: string, meta?: any) => logs.push({ level: 'error', message, meta }),
      debug: (message: string, meta?: any) => logs.push({ level: 'debug', message, meta }),
      clearLogs: () => logs.splice(0, logs.length),
      getLogsByLevel: (level: string) => logs.filter(log => log.level === level),
      getLastLog: () => logs[logs.length - 1]
    };
  }

  static mockFetch(responses: { [url: string]: any }) {
    return (url: string, options?: any) => {
      const response = responses[url] || responses['*']; // '*' for default response
      
      if (!response) {
        return Promise.reject(new Error(`No mock response for URL: ${url}`));
      }

      return Promise.resolve({
        ok: response.ok !== false,
        status: response.status || 200,
        json: () => Promise.resolve(response.data || response)
      });
    };
  }

  static validateEventEmission(logs: any[], eventName: string, expectedFields: string[]) {
    const eventLogs = logs.filter(log => 
      log.message && log.message.includes(eventName)
    );
    
    assert(eventLogs.length > 0, `Expected at least one ${eventName} event log`);
    
    const lastEventLog = eventLogs[eventLogs.length - 1];
    if (lastEventLog.meta) {
      for (const field of expectedFields) {
        assert(lastEventLog.meta.hasOwnProperty(field), 
          `Event log missing expected field: ${field}`);
      }
    }
  }

  static async assertAsyncThrows(
    asyncFn: () => Promise<any>, 
    expectedErrorType?: string,
    expectedMessage?: string
  ) {
    let error: any;
    try {
      await asyncFn();
    } catch (e) {
      error = e;
    }
    
    assert(error, 'Expected function to throw an error');
    
    if (expectedErrorType) {
      this.assertError(error, expectedErrorType, expectedMessage);
    }
    
    return error;
  }

  static createTimeoutPromise<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
      )
    ]);
  }
}
