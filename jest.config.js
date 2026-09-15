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
  collectCoverageFrom: [
    'server/src/modules/chat/**/*.ts',
    'server/src/modules/auth/**/*.ts',
    'server/src/modules/media/**/*.ts',
    'server/src/modules/ai/**/*.ts',
    'server/src/modules/ghost/**/*.ts',
    'server/src/modules/stories/**/*.ts',
    'server/src/common/auth/**/*.ts',
    'web/lib/e2ee.ts',
    '!**/*.spec.ts',
    '!**/node_modules/**',
  ],
  coverageThreshold: {
    global: {
      branches: 55,
      functions: 60,
      lines: 65,
      statements: 65,
    },
  },
};
