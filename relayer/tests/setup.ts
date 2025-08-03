// Global test setup
import '@testing-library/jest-dom';

// Set up global test environment - suppress console output during tests
global.console = {
  ...console,
  log: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
