import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    isolate: true,
    fileParallelism: false,
    maxWorkers: 1,
    clearMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    testTimeout: 15_000,
    hookTimeout: 15_000,
    include: ['src/test/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**', 'src/test/integration/**'],

    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/test/**', 'src/types/express.d.ts', 'src/db/schema.ts', 'src/**/*.d.ts'],
      thresholds: {
        lines: 95,
        statements: 93,
        functions: 95,
        branches: 86,
      },
    },
  },
});
