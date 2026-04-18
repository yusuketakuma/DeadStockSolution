import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalHome = process.env.HOME;

describe('openclaw runtime digest service', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalHome == null) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  });

  it('reads the new runtime schema from ~/.openclaw only', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'openclaw-runtime-digest-'));
    process.env.HOME = home;

    const opsDir = path.join(home, '.openclaw', 'runtime', 'openclaw-ops');
    const alertsDir = path.join(home, '.openclaw', 'runtime', 'dss-alerts');
    const codexDir = path.join(home, '.openclaw', 'runtime', 'dss-codex');
    await mkdir(opsDir, { recursive: true });
    await mkdir(alertsDir, { recursive: true });
    await mkdir(codexDir, { recursive: true });

    await writeFile(path.join(opsDir, 'openclaw-connection-run-20260408-150500.json'), JSON.stringify({
      schema: 'dss-runtime-v2',
      source: 'dss-health-monitor',
      runId: '20260408-150500',
      timestamp: '2026-04-08T06:05:00Z',
      baseUrl: 'https://dead-stock-solution.vercel.app',
      preflightStatus: 0,
      runnerStatus: 1,
      healthHttpCode: 200,
      status: 'degraded',
      reason: 'execution_failed',
      runtime: { script: 'run-openclaw-connection-operation.sh', rootDir: '/repo', runnerDir: '/runner', statePath: '/runner/state.json', hostName: 'devbox' },
      notifications: { telegramDmEnabled: true, telegramGroupEnabled: true, codexAutofixEnabled: false },
      thresholds: { awaitingUserWarning: 0, awaitingUserCritical: null },
      health: { connectorConfigured: true, webhookConfigured: true, ddsConnected: false, awaitingUser: 1, lastSeenAt: null },
      diagnostics: { preflightLogTail: 'preflight ok', runnerLogTail: 'runner failed' },
    }), 'utf8');

    await writeFile(path.join(alertsDir, 'error-buffer.ndjson'), `${JSON.stringify({
      ts: '2026-04-08T06:04:00Z',
      schema: 'dss-runtime-v2',
      source: 'dss-ci-monitor',
      component: 'github-actions',
      severity: 'error',
      category: 'ci',
      event: 'ci_failure',
      code: 'ci_failure',
      msg: 'CI失敗: unit-test (main)',
      context: { workflowName: 'unit-test', branch: 'main' },
      artifacts: { errorBuffer: '/tmp/error-buffer.ndjson' },
    })}\n`, 'utf8');

    await writeFile(path.join(codexDir, 'results.ndjson'), `${JSON.stringify({
      ts: '2026-04-08T06:05:00Z',
      schema: 'dss-runtime-v2',
      source: 'dss-health-monitor',
      component: 'codex-dispatch',
      status: 'failed',
      type: 'health-degraded',
      summary: 'codex auto-fix dispatch failed',
      log: '/tmp/codex.log',
      errorHash: 'abc',
      attempt: 1,
      maxAttempts: 3,
      dedupWindowSec: 7200,
      context: { runId: '20260408-150500' },
      artifacts: { summaryPath: '/tmp/summary.json' },
    })}\n`, 'utf8');

    const { getDdsRuntimeDigest } = await import('../services/openclaw/runtime-digest-service');
    const digest = await getDdsRuntimeDigest(new Date('2026-04-08T08:00:00Z'));

    expect(digest.latestConnection?.schema).toBe('dss-runtime-v2');
    expect(digest.latestConnection?.runId).toBe('20260408-150500');
    expect(digest.bufferedErrors.count).toBe(1);
    expect(digest.bufferedErrors.recent[0]?.code).toBe('ci_failure');
    expect(digest.codexResults.todayCount).toBe(1);
    expect(digest.codexResults.recent[0]?.status).toBe('failed');
  });
});
