/** Jest config for TESTING_SPEC.md suites. e2e/ is Playwright-only (see test:e2e). */
module.exports = {
  rootDir: __dirname,
  roots: ['<rootDir>/tests'],
  testEnvironment: 'node',
  testMatch: ['**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/tests/e2e/'],
  setupFiles: ['<rootDir>/tests/setup.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tests/tsconfig.json' }],
  },
  testTimeout: 15000,
};
