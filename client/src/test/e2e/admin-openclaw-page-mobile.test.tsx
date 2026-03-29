import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import AdminOpenClawPage from '../../pages/admin/AdminOpenClawPage';
import { mockAdminUser, renderWithProviders } from '../helpers';

function setMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AdminOpenClawPage - mobile layout', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setMatchMedia(true);
  });

  it('renders health, retry queue, and request cards on narrow viewport', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/admin/requests?page=1&limit=50')) {
        return jsonResponse({
          data: [{
            id: 88,
            pharmacyId: 5,
            pharmacyName: '薬局A',
            requestText: 'CSV出力を直してほしい',
            openclawStatus: 'pending_handoff',
            openclawThreadId: 'thread-88',
            openclawSummary: '解析中',
            workflowStatus: 'failed',
            latestSummary: 'テストが失敗しました',
            branchName: null,
            prUrl: null,
            prNumber: null,
            createdAt: '2026-03-23T10:00:00.000Z',
            updatedAt: '2026-03-23T10:30:00.000Z',
          }],
          connector: { configured: true, webhookConfigured: true, implementationBranch: 'review' },
        });
      }
      if (url.includes('/api/admin/requests/88/messages')) {
        return jsonResponse({
          request: {
            id: 88,
            pharmacyId: 5,
            pharmacyName: '薬局A',
            requestText: 'CSV出力を直してほしい',
            openclawStatus: 'pending_handoff',
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
          messages: [{ id: 1, authorType: 'system', messageType: 'status_update', body: 'テストが失敗しました', createdAt: '2026-03-23T10:30:00.000Z' }],
        });
      }
      if (url.includes('/api/admin/user-requests/88/events')) {
        return jsonResponse({
          events: [{ id: 1, eventType: 'failed', createdAt: '2026-03-23T10:30:00.000Z', summary: 'テスト失敗', note: '再試行が必要' }],
        });
      }
      if (url.includes('/api/admin/openclaw-retries?page=1&limit=20')) {
        return jsonResponse({
          data: [{
            id: 1,
            requestId: 88,
            pharmacyId: 5,
            pharmacyName: '薬局A',
            status: 'failed',
            attemptCount: 2,
            maxAttempts: 5,
            nextRetryAt: '2026-03-23T11:00:00.000Z',
            lastAttemptAt: '2026-03-23T10:40:00.000Z',
            completedAt: null,
            lastError: 'timeout',
            triggerReason: 'handoff_failed',
            createdAt: '2026-03-23T10:00:00.000Z',
            updatedAt: '2026-03-23T10:40:00.000Z',
            requestText: 'CSV出力を直してほしい',
          }],
          pagination: { page: 1, totalPages: 1, total: 1 },
          stats: { pending: 0, processing: 0, completed: 0, failed: 1 },
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
          retryQueue: { pending: 0, processing: 0, completed: 0, failed: 1 },
          handoffSuccessRate: 0.5,
          lastHandoffAt: '2026-03-23T10:00:00.000Z',
          ddsAgent: { connected: false, agentId: null, lastSeenAt: null, queuedJobs: 1, awaitingUser: 0 },
        }, 200);
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
          },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AdminOpenClawPage />, { authUser: mockAdminUser });

    await waitFor(() => {
      expect(screen.getByText('OpenClaw連携')).toBeInTheDocument();
    });

    expect(screen.getByText('DDS / OpenClaw ヘルス')).toBeInTheDocument();
    expect(screen.getByText('Retry Queue')).toBeInTheDocument();
    expect(document.querySelector('.dl-mobile-data-list')).toBeInTheDocument();
    expect(screen.getAllByText('薬局A').length).toBeGreaterThan(0);
  });
});
