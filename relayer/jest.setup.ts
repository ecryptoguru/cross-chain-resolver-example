// Import required modules
import { TextEncoder } from 'util';
import { jest } from '@jest/globals';

// Add TextEncoder to global scope for tests
// This is needed for some libraries that use these Web APIs
global.TextEncoder = TextEncoder;

// Type definition for BufferSource
type BufferSource = ArrayBufferView | ArrayBuffer;

// Create a simple TextDecoder mock
class TextDecoderMock {
  constructor(public encoding: string = 'utf-8') {}
  
  decode(input?: BufferSource | null): string {
    if (!input) return '';
    if (input instanceof ArrayBuffer) {
      return Buffer.from(input).toString('utf-8');
    }
    return Buffer.from(
      input.buffer, 
      input.byteOffset, 
      input.byteLength
    ).toString('utf-8');
  }
}

// Add TextDecoder to global scope
global.TextDecoder = TextDecoderMock as any;

global.TextDecoder = TextDecoderMock as any;

// Mock console methods to keep test output clean
const originalConsole = { ...console };

// Mock console methods
global.console = {
  ...originalConsole,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};

// Add global test timeout
const JEST_TIMEOUT = 10000; // 10 seconds

// Add global test setup
beforeAll(() => {
  // Increase the timeout for all tests
  jest.setTimeout(JEST_TIMEOUT);
});

// Reset all mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});

// Clean up after all tests are done
afterAll(() => {
  // Restore original console methods
  global.console = originalConsole;
});
