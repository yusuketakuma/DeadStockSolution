import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/test/integration/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
