// Import required modules
import { TextEncoder } from 'util';

// Add TextEncoder to global scope for tests
// This is needed for some libraries that use these Web APIs
global.TextEncoder = TextEncoder;

// Add a simple mock for TextDecoder
class TextDecoderMock {
  decode(input?: BufferSource | null): string {
    if (!input) return '';
    const buffer = input instanceof ArrayBuffer 
      ? new Uint8Array(input)
      : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    return Buffer.from(buffer).toString('utf-8');
  }
}

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
