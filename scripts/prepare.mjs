import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

function shouldSkipHuskyInstall() {
  const huskyBinary = process.platform === 'win32' ? 'node_modules/.bin/husky.cmd' : 'node_modules/.bin/husky';
  return process.env.CI === 'true'
    || process.env.VERCEL === '1'
    || process.env.NODE_ENV === 'production'
    || !existsSync('.git')
    || !existsSync(huskyBinary);
}

if (shouldSkipHuskyInstall()) {
  console.log('Skipping husky install for CI/deploy or non-git environment');
  process.exit(0);
}

const result = spawnSync('husky', { stdio: 'inherit', shell: true });

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
