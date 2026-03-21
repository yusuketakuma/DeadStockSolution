#!/usr/bin/env node
/**
 * VERSION ファイルを Single Source of Truth として、
 * 全 package.json の version フィールドを同期する。
 *
 * 用途:
 *   - pre-commit hook で自動実行（lint-staged 経由）
 *   - ビルド前に手動実行: node scripts/sync-version.mjs
 *   - CI で検証: node scripts/sync-version.mjs --check
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');

let version;
try {
  version = readFileSync(resolve(root, 'VERSION'), 'utf-8').trim();
} catch (err) {
  console.error(`Failed to read VERSION file at ${resolve(root, 'VERSION')}: ${err.message}`);
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`Invalid version in VERSION file: "${version}"`);
  process.exit(1);
}

const targets = ['package.json', 'client/package.json', 'server/package.json'];
let dirty = false;

for (const rel of targets) {
  const path = resolve(root, rel);
  const pkg = JSON.parse(readFileSync(path, 'utf-8'));
  if (pkg.version !== version) {
    if (checkOnly) {
      console.error(`Version mismatch: ${rel} has "${pkg.version}", expected "${version}"`);
      dirty = true;
    } else {
      pkg.version = version;
      writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
      console.log(`Updated ${rel}: ${pkg.version} → ${version}`);
    }
  }
}

if (checkOnly && dirty) {
  console.error('\nRun "node scripts/sync-version.mjs" to fix.');
  process.exit(1);
}

if (!checkOnly && !dirty) {
  console.log(`All package.json files already at v${version}`);
}
