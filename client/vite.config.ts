/// <reference types="vitest" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react-swc';
import { visualizer } from 'rollup-plugin-visualizer';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig, loadEnv, type PluginOption } from 'vite';

function readVersionFile(): string | undefined {
  try {
    return readFileSync(new URL('../VERSION', import.meta.url), 'utf-8').trim();
  } catch {
    return undefined;
  }
}

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
  const appVersion = normalizeVersion(envVersion || readVersionFile());
  const apiProxyTarget = env.VITE_API_PROXY_TARGET?.trim() || 'http://127.0.0.1:3001';

  const plugins: PluginOption[] = [react()];

  plugins.push(
    VitePWA({
      registerType: 'prompt',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      manifest: false,
      injectManifest: {
        globDirectory: 'dist',
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        globIgnores: ['**/node_modules/**/*', 'sw.js'],
      },
    }) as PluginOption,
  );

  if (process.env.ANALYZE === 'true') {
    plugins.push(
      visualizer({
        template: 'treemap',
        filename: 'stats.html',
        gzipSize: true,
        open: false,
      }) as PluginOption,
    );
  }

  return {
    plugins,
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __VERCEL_ENV__: JSON.stringify(env.VERCEL_ENV?.trim() || env.VITE_VERCEL_ENV?.trim() || ''),
    },
    build: {
      chunkSizeWarningLimit: 500,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('@tanstack/react-query')) {
                return 'vendor-query';
              }
              if (id.includes('@zxing/')) {
                return 'vendor-zxing';
              }
              if (id.includes('@sentry/')) {
                return 'vendor-sentry';
              }
              if (id.includes('react-bootstrap') || id.includes('bootstrap')) {
                return 'vendor-bootstrap';
              }
              if (
                id.includes('@hookform/resolvers') ||
                id.includes('react-hook-form') ||
                id.includes('zod')
              ) {
                return 'vendor-forms';
              }
              if (
                id.includes('/react/') ||
                id.includes('/react-dom/') ||
                id.includes('react-router-dom')
              ) {
                return 'vendor-react';
              }
              if (id.includes('chart.js') || id.includes('react-chartjs-2')) {
                return 'vendor-charts';
              }
            }
            if (id.includes('/pages/admin/')) {
              return 'admin-pages';
            }
          },
        },
      },
    },
    server: {
      host: '127.0.0.1',
      proxy: {
        '/api': {
          target: apiProxyTarget,
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
