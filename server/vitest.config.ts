import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/test/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: './coverage',
      exclude: ['src/test/**', 'src/types/express.d.ts'],
      thresholds: {
        lines: 49,
        statements: 48,
        functions: 56,
        branches: 42,
      },
    },
  },
});
