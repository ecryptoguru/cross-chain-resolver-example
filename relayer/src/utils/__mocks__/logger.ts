// Mock logger implementation for tests
export const logger = {
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  verbose: jest.fn(),
  silly: jest.fn(),
};

export default logger;
