import '@testing-library/jest-dom';
import { jest } from '@jest/globals';

// Set up global test environment - suppress console output during tests
const originalConsole = global.console;

global.console = {
  ...originalConsole,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Restore original console after tests
// @ts-ignore
afterAll(() => {
  global.console = originalConsole;
});
