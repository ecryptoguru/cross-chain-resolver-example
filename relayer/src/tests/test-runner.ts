/**
 * Simple test runner using Node.js built-in test capabilities
 * Replaces vitest dependency with native Node.js testing
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';

// Export test utilities for compatibility
export { test as it, describe, assert as expect };

// Mock utilities for testing
type MockFunction = {
  (...args: any[]): any;
  _mockReturnValue: any;
  _calls: any[];
  mockReturnValue: (value: any) => MockFunction;
  mockResolvedValue: (value: any) => MockFunction;
  mockRejectedValue: (error: any) => MockFunction;
  mockImplementation: (impl: Function) => MockFunction;
};

export const vi = {
  fn: (): MockFunction => {
    const mockFn = ((...args: any[]) => {
      mockFn._calls.push(args);
      return mockFn._mockReturnValue;
    }) as any;
    
    mockFn._mockReturnValue = undefined;
    mockFn._calls = [];
    
    mockFn.mockReturnValue = (value: any) => {
      mockFn._mockReturnValue = value;
      return mockFn;
    };
    
    mockFn.mockResolvedValue = (value: any) => {
      mockFn._mockReturnValue = Promise.resolve(value);
      return mockFn;
    };
    
    mockFn.mockRejectedValue = (error: any) => {
      mockFn._mockReturnValue = Promise.reject(error);
      return mockFn;
    };
    
    mockFn.mockImplementation = (impl: Function) => {
      mockFn._mockReturnValue = impl;
      return mockFn;
    };
    
    return mockFn;
  },
  clearAllMocks: () => {},
  restoreAllMocks: () => {}
};

export interface Mock {
  (...args: any[]): any;
  mockReturnValue(value: any): Mock;
  mockResolvedValue(value: any): Mock;
  mockRejectedValue(error: any): Mock;
  mockImplementation(impl: Function): Mock;
}

// Lifecycle hooks
export const beforeEach = (fn: () => void) => {
  // Simple implementation for beforeEach
  fn();
};

export const afterEach = (fn: () => void) => {
  // Simple implementation for afterEach
  fn();
};
