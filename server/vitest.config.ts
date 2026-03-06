import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    isolate: true,
    include: ['src/test/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**', 'src/test/integration/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: './coverage',
      exclude: ['src/test/**', 'src/types/express.d.ts', 'src/db/schema.ts'],
      thresholds: {
        lines: 95,
        statements: 93,
        functions: 95,
        branches: 86,
      },
    },
  },
});
