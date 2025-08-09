/*
 * Jest configuration for ESM and TypeScript support
 * https://jestjs.io/docs/configuration
 */

export default {
  // Clear mock calls and instances between tests
  clearMocks: true,
  
  // The test environment that will be used for testing
  testEnvironment: 'node',
  
  // The root directory that Jest should scan for tests and modules within
  rootDir: '.',
  
  // A list of paths to directories that Jest should use to search for files in
  roots: [
    '<rootDir>/relayer/tests'
  ],
  
  // The glob patterns Jest uses to detect test files
  testMatch: [
    '**/__tests__/**/*.test.[jt]s?(x)',
    '**/?(*.)+(spec|test).[tj]s?(x)'
  ],
  
  // An array of regexp pattern strings that are matched against all test paths before executing the test
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/'
  ],
  
  // A map from regular expressions to paths to transformers
  transform: {
    '^.+\\.(t|j)sx?$': ['@swc/jest', {
      jsc: {
        parser: {
          syntax: 'typescript',
          tsx: false,
          decorators: false,
          dynamicImport: true,
        },
        target: 'es2020',
        transform: {
          react: {
            runtime: 'automatic'
          }
        },
        baseUrl: '.',
      },
      module: {
        type: 'es6',
        strict: true,
        strictMode: true,
        lazy: false,
        noInterop: false
      },
    }]
  },
  
  // An array of file extensions your modules use
  moduleFileExtensions: ['js', 'jsx', 'ts', 'tsx', 'json', 'node'],
  
  // A map from regular expressions to module names that allow to stub out resources
  moduleNameMapper: {
    '^(\.{1,2}/.*)\\.js$': '$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    // Map near-api-js to a local mock to satisfy jest.setup.mjs without installing the package
    '^near-api-js$': '<rootDir>/relayer/tests/mocks/near-api-js.ts',
  },
  
  // A list of paths to modules that run some code to configure or set up the testing framework
  setupFilesAfterEnv: ['<rootDir>/jest.setup.mjs'],
  
  // An array of regexp pattern strings that are matched against all source file paths before transformation
  transformIgnorePatterns: [
    '/node_modules/(?!(chalk|@babel/runtime)/)'
  ],
  
  // Indicates whether each individual test should be reported during the run
  verbose: true,
  
  // Whether to use watchman for file crawling
  watchman: true,
  
  // Automatically reset mock state between every test
  resetMocks: true,
  
  // Reset the module registry before running each individual test
  resetModules: true,
  
  // Automatically restore mock state between every test
  restoreMocks: true,
  
  // Using testMatch instead of testRegex to avoid conflicts
  
  // This option allows the use of a custom test runner
  // testRunner: 'jest-circus/runner',
  
  // This option allows you to use custom reporters
  // reporters: ['default', 'jest-junit'],
  
  // The directory where Jest should output its coverage files
  coverageDirectory: 'coverage',
  
  // An array of regexp pattern strings used to skip coverage collection
  coveragePathIgnorePatterns: [
    '/node_modules/'
  ],
  
  // Indicates which provider should be used to instrument code for coverage
  coverageProvider: 'v8',
  
  // A list of reporter names that Jest uses when writing coverage reports
  coverageReporters: [
    'json',
    'text',
    'lcov',
    'clover'
  ],
  
  // An object that configures minimum threshold enforcement for coverage results
  // coverageThreshold: {
  //   global: {
  //     branches: 80,
  //     functions: 80,
  //     lines: 80,
  //     statements: 80
  //   }
  // },
  
  // Make calling deprecated APIs throw helpful error messages
  errorOnDeprecated: true,
  
  // Force coverage collection from ignored files using an array of glob patterns
  // forceCoverageMatch: [],
  
  // A path to a module which exports an async function that is triggered once before all test suites
  // globalSetup: undefined,
  
  // A path to a module which exports an async function that is triggered once after all test suites
  // globalTeardown: undefined,
  
  // A set of global variables that need to be available in all test environments
  // globals: {},
  
  // The maximum amount of workers used to run your tests. Can be specified as % or a number.
  // maxWorkers: '50%',
  
  // Activates notifications for test results
  // notify: false,
  
  // An enum that specifies notification mode. Requires { notify: true }
  // notifyMode: 'failure-change',
  
  // A preset that is used as a base for Jest's configuration
  // preset: undefined,
  
  // Run tests from one or more projects
  // projects: undefined,
  
  // Use this configuration option to add custom reporters to Jest
  // reporters: undefined,
  
  // Allows you to use a custom runner instead of Jest's default test runner
  // runner: 'jest-runner',
  
  // The paths to modules that run some code to configure or set up the testing environment before each test
  // setupFiles: [],
  
  // The number of seconds after which a test is considered as slow and reported as such in the results
  // slowTestThreshold: 5,
  
  // A list of paths to snapshot serializer modules Jest should use for snapshot testing
  // snapshotSerializers: [],
  
  // The test environment that will be used for testing
  // testEnvironment: 'node',
  
  // Options that will be passed to the testEnvironment
  // testEnvironmentOptions: {},
  
  // Adds a location field to test results
  // testLocationInResults: false,
  
  // An array of regexp pattern strings that are matched against all test paths, matched tests are skipped
  // testPathIgnorePatterns: [],
  
  // The regexp pattern or array of patterns that Jest uses to detect test files
  // testRegex: [],
  
  // This option allows use of a custom test runner
  // testRunner: 'jasmine2',
  
  // This option sets the URL for the jsdom environment. It is reflected in properties such as location.href
  // testURL: 'http://localhost',
  
  // Setting this value to 'fake' allows the use of fake timers for functions such as 'setTimeout'
  // timers: 'real',
  
  // A map from regular expressions to paths to transformers
  // transform: undefined,
  
  // An array of regexp pattern strings that are matched against all source file paths, matched files will skip transformation
  // transformIgnorePatterns: [],
  
  // An array of regexp pattern strings that are matched against all modules before the module loader will automatically return a mock for them
  // unmockedModulePathPatterns: undefined,
  
  // Indicates whether each individual test should be reported during the run
  // verbose: undefined,
  
  // An array of regexp patterns that are matched against all source file paths before re-running tests in watch mode
  // watchPathIgnorePatterns: [],
  
  // Whether to use watchman for file crawling
  // watchman: true,
}
