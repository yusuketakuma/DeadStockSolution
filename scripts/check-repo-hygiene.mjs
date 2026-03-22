#!/usr/bin/env node

import { readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const ignoredDirs = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  'out',
  '.next',
  '.turbo',
  '.npm-cache',
  '.claude',
]);

const disallowedFiles = new Set(['.DS_Store']);
const violations = [];

// ─── 1. Filesystem walk: .DS_Store ───────────────────────────────────────────

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolutePath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) {
        continue;
      }
      walk(absolutePath);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (disallowedFiles.has(entry.name)) {
      violations.push({ file: relative(rootDir, absolutePath), reason: 'disallowed file (.DS_Store)' });
    }
  }
}

walk(rootDir);

// ─── 2. Git-tracked file checks ──────────────────────────────────────────────
// Patterns that should never be committed. These are normally .gitignored, but
// we guard against accidental `git add -f` or misconfigured .gitignore.

const GENERATED_DIR_PATTERNS = [
  /^dist\//,
  /\/dist\//,
  /^build\//,
  /\/build\//,
  /^coverage\//,
  /\/coverage\//,
  /^\.next\//,
  /\/\.next\//,
  /^\.turbo\//,
  /\/\.turbo\//,
];

const GENERATED_FILE_PATTERNS = [
  /\.tsbuildinfo$/,
];

// node_modules in unexpected places (top-level is expected in a monorepo root,
// but nested workspace node_modules that got force-added are a smell)
const NODE_MODULES_PATTERN = /\/node_modules\//;

const LOCAL_STATE_PATTERNS = [
  /^\.claude\/state\//,
  /\/\.claude\/state\//,
  /^\.claude\/sessions\//,
  /\/\.claude\/sessions\//,
  /\.env\.local$/,
  /\.env\.\w+\.local$/,
];

let trackedFiles = [];
try {
  const output = execSync('git ls-files', { cwd: rootDir, encoding: 'utf8' });
  trackedFiles = output.split('\n').filter(Boolean);
} catch {
  // Not a git repo or git unavailable — skip git-based checks
}

let stagedFiles = [];
try {
  const output = execSync('git diff --cached --name-only', { cwd: rootDir, encoding: 'utf8' });
  stagedFiles = output.split('\n').filter(Boolean);
} catch {
  // Ignore
}

const filesToCheck = [...new Set([...trackedFiles, ...stagedFiles])];

for (const file of filesToCheck) {
  for (const pattern of GENERATED_DIR_PATTERNS) {
    if (pattern.test(file)) {
      violations.push({ file, reason: 'generated output directory (should not be committed)' });
      break;
    }
  }

  for (const pattern of GENERATED_FILE_PATTERNS) {
    if (pattern.test(file)) {
      violations.push({ file, reason: 'generated build artifact (*.tsbuildinfo should not be committed)' });
      break;
    }
  }

  if (NODE_MODULES_PATTERN.test(file)) {
    violations.push({ file, reason: 'node_modules tracked in git (should not be committed)' });
  }

  for (const pattern of LOCAL_STATE_PATTERNS) {
    if (pattern.test(file)) {
      violations.push({ file, reason: 'local state / environment file (should not be committed)' });
      break;
    }
  }
}

// ─── 3. Report ───────────────────────────────────────────────────────────────

if (violations.length > 0) {
  console.error('[repo:hygiene] Violations found:\n');
  for (const { file, reason } of violations.sort((a, b) => a.file.localeCompare(b.file))) {
    console.error(`  ${file}`);
    console.error(`    reason: ${reason}`);
    console.error(`    fix:    git rm --cached "${file}"`);
    console.error('');
  }
  console.error('[repo:hygiene] After running the fix commands, add the paths to .gitignore if not already covered.');
  process.exit(1);
}

console.log('[repo:hygiene] OK');
