import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const scriptPath = path.join(repoRoot, 'scripts', 'run-openclaw-connection-operation.sh');

async function makeExecutable(filePath, content) {
  await writeFile(filePath, content, 'utf8');
  await chmod(filePath, 0o755);
}

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

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('failed to bind test server'));
        return;
      }
      resolve(address.port);
    });
    server.on('error', reject);
  });
}

describe('run-openclaw-connection-operation.sh', () => {
  const cleanup = [];

  afterEach(async () => {
    while (cleanup.length > 0) {
      const server = cleanup.pop();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('records failing preflight and missing runner status while still writing a summary without state.json', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'openclaw-ops-test-'));
    const fakeRepoRoot = path.join(tempRoot, 'repo');
    const fakeScriptsDir = path.join(fakeRepoRoot, 'scripts');
    const fakeRunnerDir = path.join(tempRoot, 'runner');
    const logRoot = path.join(tempRoot, 'logs');

    await mkdir(fakeScriptsDir, { recursive: true });
    await mkdir(path.join(fakeRunnerDir, 'scripts'), { recursive: true });
    await mkdir(logRoot, { recursive: true });

    await makeExecutable(
      path.join(fakeScriptsDir, 'openclaw-connection-preflight.sh'),
      '#!/usr/bin/env bash\nset -euo pipefail\necho "{\\"stub\\":true}"\nexit 17\n',
    );

    const server = createServer((req, res) => {
      if (req.url === '/api/health/openclaw') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          connector: { configured: true },
          webhook: { configured: true },
          ddsAgent: {
            connected: true,
            awaitingUser: 0,
            lastSeenAt: '2026-04-04T00:00:00.000Z',
          },
        }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    cleanup.push(server);

    const port = await listen(server);
    const result = await runScript([`http://127.0.0.1:${port}`], {
      OPENCLAW_ROOT_DIR: fakeRepoRoot,
      OPENCLAW_RUNNER_DIR: fakeRunnerDir,
      OPENCLAW_OPS_LOG_DIR: logRoot,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('preflight_status=17');
    expect(result.stdout).toContain('runner_status=127');
    expect(result.stdout).toContain('status=degraded');
    expect(result.stdout).toContain('reason=execution_failed');

    const summaryFile = (await readdir(logRoot)).find((name) => name.startsWith('openclaw-connection-run-'));
    expect(summaryFile).toBeTruthy();

    const summary = JSON.parse(await readFile(path.join(logRoot, summaryFile), 'utf8'));
    expect(summary.schema).toBe('dss-runtime-v2');
    expect(summary.source).toBe('dss-health-monitor');
    expect(summary.runId).toBeTruthy();
    expect(summary.preflightStatus).toBe(17);
    expect(summary.runnerStatus).toBe(127);
    expect(summary.status).toBe('degraded');
    expect(summary.runtime.rootDir).toBe(fakeRepoRoot);
    expect(summary.notifications.codexAutofixEnabled).toBe(false);
    expect(summary.diagnostics.preflightLogTail).toContain('{"stub":true}');
    expect(summary.artifacts.runnerState).toEqual({});
    expect(summary.artifacts.healthSnapshot).toContain('openclaw-ops-health-');
  });

  it('buffers warning notifications when ddsAgent is disconnected without degrading the run', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'openclaw-ops-test-'));
    const fakeRepoRoot = path.join(tempRoot, 'repo');
    const fakeScriptsDir = path.join(fakeRepoRoot, 'scripts');
    const fakeRunnerDir = path.join(tempRoot, 'runner');
    const logRoot = path.join(tempRoot, 'logs');

    await mkdir(fakeScriptsDir, { recursive: true });
    await mkdir(path.join(fakeRunnerDir, 'scripts'), { recursive: true });
    await mkdir(logRoot, { recursive: true });

    await makeExecutable(
      path.join(fakeScriptsDir, 'openclaw-connection-preflight.sh'),
      '#!/usr/bin/env bash\nset -euo pipefail\necho "{\\"stub\\":true}"\n',
    );

    await makeExecutable(
      path.join(fakeRunnerDir, 'scripts', 'run-dds-agent-runner.mjs'),
      '#!/usr/bin/env node\nconsole.log("runner ok");\n',
    );

    const server = createServer((req, res) => {
      if (req.url === '/api/health/openclaw') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          connector: { configured: true },
          webhook: { configured: true },
          ddsAgent: {
            connected: false,
            awaitingUser: 0,
            lastSeenAt: '2026-04-04T00:00:00.000Z',
          },
        }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    cleanup.push(server);

    const port = await listen(server);
    const result = await runScript([`http://127.0.0.1:${port}`], {
      HOME: tempRoot,
      OPENCLAW_ROOT_DIR: fakeRepoRoot,
      OPENCLAW_RUNNER_DIR: fakeRunnerDir,
      OPENCLAW_OPS_LOG_DIR: logRoot,
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('status=warning');
    expect(result.stdout).toContain('reason=dds_not_connected');

    const errorBufferPath = path.join(tempRoot, '.openclaw', 'runtime', 'dss-alerts', 'error-buffer.ndjson');
    const errorBuffer = await readFile(errorBufferPath, 'utf8');
    expect(errorBuffer).toContain('dds_not_connected');
    const errorEntry = JSON.parse(errorBuffer.trim());
    expect(errorEntry.schema).toBe('dss-runtime-v2');
    expect(errorEntry.source).toBe('dss-health-monitor');
    expect(errorEntry.category).toBe('health');
    expect(errorEntry.code).toBe('dds_not_connected');
    expect(errorEntry.context.status).toBe('warning');
    expect(errorEntry.context.awaitingUser).toBe(0);

    const summaryFile = (await readdir(logRoot)).find((name) => name.startsWith('openclaw-connection-run-'));
    expect(summaryFile).toBeTruthy();

    const summary = JSON.parse(await readFile(path.join(logRoot, summaryFile), 'utf8'));
    expect(summary.schema).toBe('dss-runtime-v2');
    expect(summary.status).toBe('warning');
    expect(summary.reason).toBe('dds_not_connected');
    expect(summary.health.ddsConnected).toBe(false);
    expect(summary.healthHttpCode).toBe(200);
  });
});
