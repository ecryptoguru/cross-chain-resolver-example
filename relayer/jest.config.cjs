module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  globals: {
    'ts-jest': {
      useESM: true,
      tsconfig: 'tsconfig.json',
    },
  },
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testMatch: [
    '**/tests/**/*.test.ts',
    '**/src/**/*.test.ts',
    '**/__tests__/**/*.ts',
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  testTimeout: 30000,
  verbose: true,
  transformIgnorePatterns: [
    'node_modules/(?!(ethers|@ethersproject/.*|@nomicfoundation/.*)/)',
  ],
};
