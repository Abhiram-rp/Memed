import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  setupFiles: ['<rootDir>/tests/setup.ts'],
  // Integration tests boot an in-memory Mongo replica set, so allow more time.
  testTimeout: 30000,
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
  // Phase 1 exit criteria: 100% coverage on the pure payout and ladder logic.
  // Phase 9 adds the pure spike detector to the same gate.
  // `npm run test:coverage` enforces the threshold below.
  collectCoverageFrom: [
    'src/domain/payout.ts',
    'src/domain/milestones.ts',
    'src/domain/spike.ts',
  ],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: { branches: 100, functions: 100, lines: 100, statements: 100 },
  },
  clearMocks: true,
  verbose: true,
};

export default config;
