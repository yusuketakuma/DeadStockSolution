// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import AdminOpenClawPage from '../../pages/admin/AdminOpenClawPage';
import { mockAdminUser, renderWithProviders } from '../helpers';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AdminOpenClawPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('surfaces failed workflow items and allows retry from the list', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockAdminUser);
      }
      if (url.includes('/api/timeline/bootstrap')) {
        return jsonResponse({
          timeline: { events: [], total: 0, limit: 20, hasMore: false, nextCursor: null },
          digest: { events: [] },
          unreadCount: 0,
        });
      }
      if (url.includes('/api/timeline/unread-count')) {
        return jsonResponse({ unreadCount: 0 });
      }
      if (url.includes('/api/admin/requests?page=1&limit=50')) {
        return jsonResponse({
          data: [
            {
              id: 88,
              pharmacyId: 5,
              pharmacyName: '薬局A',
              requestText: 'CSV出力を直してほしい',
              openclawStatus: 'in_dialogue',
              openclawThreadId: 'thread-88',
              openclawSummary: '解析中',
              workflowStatus: 'failed',
              latestSummary: 'テストが失敗しました',
              branchName: null,
              prUrl: null,
              prNumber: null,
              createdAt: '2026-03-23T10:00:00.000Z',
              updatedAt: '2026-03-23T10:30:00.000Z',
            },
          ],
          connector: {
            configured: true,
            webhookConfigured: true,
            implementationBranch: 'review',
          },
        });
      }
      if (url.includes('/api/admin/requests/88/messages')) {
        return jsonResponse({
          request: {
            id: 88,
            pharmacyId: 5,
            pharmacyName: '薬局A',
            requestText: 'CSV出力を直してほしい',
            openclawStatus: 'in_dialogue',
            openclawThreadId: 'thread-88',
            openclawSummary: '解析中',
            workflowStatus: 'failed',
            latestSummary: 'テストが失敗しました',
            branchName: null,
            prUrl: null,
            prNumber: null,
            createdAt: '2026-03-23T10:00:00.000Z',
            updatedAt: '2026-03-23T10:30:00.000Z',
          },
          messages: [
            { id: 1, authorType: 'system', messageType: 'status_update', body: 'テストが失敗しました', createdAt: '2026-03-23T10:30:00.000Z' },
          ],
        });
      }
      if (url.includes('/api/admin/user-requests/88/events')) {
        return jsonResponse({ events: [] });
      }
      if (url.includes('/api/admin/openclaw-retries?page=1&limit=20')) {
        return jsonResponse({
          data: [],
          pagination: { page: 1, totalPages: 1, total: 0 },
          stats: { pending: 0, processing: 0, completed: 0, failed: 0 },
        });
      }
      if (url.includes('/api/health/openclaw')) {
        return jsonResponse({
          status: 'degraded',
          timestamp: '2026-03-23T10:40:00.000Z',
          connector: { configured: true, mode: 'gateway' },
          webhook: { configured: true },
          commands: { enabled: true },
          logPush: { enabled: true },
          autoFix: { enabled: false },
          autoEscalate: { enabled: false },
          retryQueue: { pending: 0, processing: 0, completed: 0, failed: 0 },
          handoffSuccessRate: 0.5,
          lastHandoffAt: '2026-03-23T10:00:00.000Z',
          ddsAgent: { connected: false, agentId: null, lastSeenAt: null, queuedJobs: 1, awaitingUser: 0 },
        });
      }
      if (url.includes('/api/admin/openclaw/dds-agent')) {
        return jsonResponse({
          data: {
            environment: 'production',
            connected: false,
            agentId: null,
            agentName: null,
            lastSeenAt: null,
            queuedJobs: 1,
            awaitingUser: 0,
            latestPrUrl: null,
            runtimeDigest: {
              generatedAt: '2026-03-23T10:41:00.000Z',
              latestConnection: {
                schema: 'dss-runtime-v2',
                source: 'dss-health-monitor',
                runId: '20260323-104100',
                timestamp: '2026-03-23T10:41:00.000Z',
                baseUrl: 'https://dead-stock-solution.vercel.app',
                preflightStatus: 0,
                runnerStatus: 1,
                healthHttpCode: 200,
                status: 'degraded',
                reason: 'execution_failed',
                runtime: { script: 'run-openclaw-connection-operation.sh', rootDir: '/repo', runnerDir: '/runner', statePath: '/state.json', hostName: 'devbox' },
                notifications: { telegramDmEnabled: true, telegramGroupEnabled: true, codexAutofixEnabled: false },
                thresholds: { awaitingUserWarning: 0, awaitingUserCritical: null },
                health: { connectorConfigured: true, webhookConfigured: true, ddsConnected: false, awaitingUser: 1, lastSeenAt: null },
                diagnostics: { preflightLogTail: 'preflight ok', runnerLogTail: 'runner failed' },
                alerts: { enabled: true, log: '/tmp/alerts.ndjson', reasons: [] },
              },
              bufferedErrors: {
                count: 1,
                bySeverity: { error: 1 },
                bySource: { 'dss-ci-monitor': 1 },
                recent: [{
                  ts: '2026-03-23T10:40:30.000Z',
                  schema: 'dss-runtime-v2',
                  source: 'dss-ci-monitor',
                  component: 'github-actions',
                  severity: 'error',
                  category: 'ci',
                  event: 'ci_failure',
                  code: 'ci_failure',
                  msg: 'CI失敗: unit-test (main)',
                  context: {},
                  artifacts: {},
                }],
              },
              codexResults: {
                todayCount: 1,
                todayByStatus: { failed: 1 },
                recent: [{
                  ts: '2026-03-23T10:41:00.000Z',
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
                  context: {},
                  artifacts: {},
                }],
              },
            },
          },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AdminOpenClawPage />);

    await waitFor(() => {
      expect(screen.getByText('OpenClaw連携')).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText('失敗: 1')).toBeTruthy();
    });

    expect(screen.getAllByText('失敗').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '再連携' })).toBeTruthy();
    expect(screen.getByText('DSS Runtime ログ')).toBeTruthy();
    expect(screen.getByText('最近のエラーイベント')).toBeTruthy();
    expect(screen.getByText('最近の Auto-Fix')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'ユーザーリクエスト管理' }).some((link) => link.getAttribute('href') === '/admin/user-requests')).toBe(true);
    expect(screen.getAllByRole('link', { name: 'レート制限設定' }).some((link) => link.getAttribute('href') === '/admin/rate-limits')).toBe(true);
  });
});
