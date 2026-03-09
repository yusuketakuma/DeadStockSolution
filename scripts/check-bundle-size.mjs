#!/usr/bin/env node
/**
 * Bundle size checker for CI.
 * Reads .js files in client/dist/assets/ and reports size warnings.
 * Exit 0 always (warnings only, not errors) for initial rollout.
 */

import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOTAL_WARN_BYTES = 2 * 1024 * 1024; // 2 MB
const CHUNK_WARN_BYTES = 500 * 1024;       // 500 kB

const distDir = fileURLToPath(new URL('../client/dist/assets', import.meta.url));

let files;
try {
  files = readdirSync(distDir);
} catch {
  console.error(`[check-bundle-size] dist/assets not found: ${distDir}`);
  console.error('Run "npm run build:client" first.');
  process.exit(1);
}

const jsFiles = files.filter((f) => extname(f) === '.js');

if (jsFiles.length === 0) {
  console.warn('[check-bundle-size] No .js files found in dist/assets.');
  process.exit(0);
}

let totalBytes = 0;
let hasWarning = false;

for (const file of jsFiles) {
  const filePath = join(distDir, file);
  const { size } = statSync(filePath);
  totalBytes += size;

  const sizeKb = (size / 1024).toFixed(1);
  if (size > CHUNK_WARN_BYTES) {
    console.warn(
      `[check-bundle-size] WARNING: ${file} is ${sizeKb} kB (> ${CHUNK_WARN_BYTES / 1024} kB limit)`,
    );
    hasWarning = true;
  }
}

const totalMb = (totalBytes / 1024 / 1024).toFixed(2);

if (totalBytes > TOTAL_WARN_BYTES) {
  console.warn(
    `[check-bundle-size] WARNING: Total JS bundle is ${totalMb} MB (> ${TOTAL_WARN_BYTES / 1024 / 1024} MB limit)`,
  );
  hasWarning = true;
}

if (!hasWarning) {
  console.log(`[check-bundle-size] OK — Total JS bundle: ${totalMb} MB (${jsFiles.length} chunks)`);
}

process.exit(0);
