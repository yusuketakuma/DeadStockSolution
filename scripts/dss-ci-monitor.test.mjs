import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const scriptPath = path.join(repoRoot, 'scripts', 'dss-ci-monitor.sh');

function runScript(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [scriptPath, ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...env,
      },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

describe('dss-ci-monitor.sh', () => {
  it('flushes structured buffered errors without losing the detailed schema', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'dss-ci-monitor-test-'));
    const errorDir = path.join(tempRoot, '.openclaw', 'runtime', 'dss-alerts');
    await mkdir(errorDir, { recursive: true });

    const entry = {
      ts: '2026-04-08T06:00:00Z',
      schema: 'dss-runtime-v2',
      source: 'dss-ci-monitor',
      component: 'github-actions',
      severity: 'error',
      category: 'ci',
      event: 'ci_failure',
      code: 'ci_failure',
      msg: 'CI失敗: unit-test (main) https://example.invalid/run/1',
      context: {
        repo: 'yusuketakuma/DeadStockSolution',
        workflowRunId: '1',
        workflowName: 'unit-test',
        branch: 'main',
        url: 'https://example.invalid/run/1',
      },
      artifacts: {
        errorBuffer: path.join(errorDir, 'error-buffer.ndjson'),
      },
    };

    await writeFile(path.join(errorDir, 'error-buffer.ndjson'), `${JSON.stringify(entry)}\n`, 'utf8');

    const result = await runScript(['--flush-errors'], {
      HOME: tempRoot,
      OPENCLAW_CODEX_AUTOFIX_ENABLED: 'false',
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');

    const archived = (await readdir(errorDir)).find((name) => name.startsWith('error-buffer-') && name.endsWith('.ndjson'));
    expect(archived).toBeTruthy();

    const archivedContent = await readFile(path.join(errorDir, archived), 'utf8');
    const archivedEntry = JSON.parse(archivedContent.trim());
    expect(archivedEntry.schema).toBe('dss-runtime-v2');
    expect(archivedEntry.source).toBe('dss-ci-monitor');
    expect(archivedEntry.context.workflowName).toBe('unit-test');
  });
});
