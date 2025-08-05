export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      useESM: true,
      tsconfig: 'tsconfig.json'
    }]
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testMatch: [
    '**/tests/**/*.test.ts',
    '**/src/**/*.test.ts',
    '**/__tests__/**/*.ts'
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
  ],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  transformIgnorePatterns: [
    'node_modules/(?!(.*)/)'
  ],
  testTimeout: 30000
};
