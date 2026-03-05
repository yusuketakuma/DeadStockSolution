/// <reference types="vitest" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

type PackageJson = {
  version?: string;
};

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8')
) as PackageJson;

function normalizeVersion(version: string | undefined): string {
  const trimmed = version?.trim();
  if (!trimmed) {
    return 'v0.0.0';
  }
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`;
}

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, '');
  const envVersion = env.VITE_APP_VERSION?.trim();
  const appVersion = normalizeVersion(envVersion || packageJson.version);

  return {
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    server: {
      host: '127.0.0.1',
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: true,
      coverage: {
        provider: 'v8',
        reporter: ['text-summary', 'lcov'],
        reportsDirectory: './coverage',
        include: [
          'src/utils/navigation.ts',
          'src/utils/proposal-status.ts',
          'src/utils/proposal-timeline.ts',
        ],
        thresholds: {
          lines: 95,
          statements: 95,
          functions: 95,
          branches: 95,
        },
      },
    },
  };
});
