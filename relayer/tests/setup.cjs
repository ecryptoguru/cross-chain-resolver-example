// Plain CommonJS Jest setup file
// Suppress console output during tests

const { MOCK_CONFIG } = require('./test-config.js');
const originalConsole = { ...global.console };
const consoleMocks = {
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

beforeAll(() => {
  Object.assign(global.console, consoleMocks);
});

afterAll(() => {
  Object.assign(global.console, originalConsole);
});

afterEach(() => {
  jest.clearAllMocks();
});
