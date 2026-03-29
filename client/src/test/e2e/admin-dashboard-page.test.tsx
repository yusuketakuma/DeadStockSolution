import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import AdminDashboardPage from '../../pages/admin/AdminDashboardPage';
import { mockAdminUser, renderWithProviders } from '../helpers';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AdminDashboardPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does not surface a page-level error when only OpenClaw health is degraded', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/admin/stats')) {
        return jsonResponse({
          totalPharmacies: 12,
          activePharmacies: 10,
          inactivePharmacies: 2,
          totalUploads: 33,
          totalProposals: 18,
          totalExchanges: 7,
          totalPickupItems: 21,
          totalExchangeValue: 125000,
        });
      }
      if (url.includes('/api/admin/risk/overview')) {
        return jsonResponse({
          totalPharmacies: 12,
          highRiskPharmacies: 1,
          mediumRiskPharmacies: 2,
          lowRiskPharmacies: 9,
          avgRiskScore: 14.5,
        });
      }
      if (url.includes('/api/admin/observability?minutes=60')) {
        return jsonResponse({
          windowMinutes: 60,
          totalRequests: 120,
          totalErrors5xx: 0,
          errorRate5xx: 0,
          authFailures401: 0,
          forbidden403: 0,
          avgLatencyMs: 120,
          p95LatencyMs: 220,
          topSlowPaths: [],
          logPush: {
            enqueued: 0,
            sent: 0,
            failed: 0,
            retried: 0,
          },
        });
      }
      if (url.includes('/api/admin/alerts')) {
        return jsonResponse({
          failedUploadJobs24h: 0,
          stalledUploadJobs24h: 0,
          unreadNotifications: 0,
          pendingProposalActions24h: 0,
        });
      }
      if (url.includes('/api/admin/kpis?minutes=60')) {
        return jsonResponse({
          status: 'healthy',
          metrics: {
            errorRate5xx: 0,
            uploadFailureRate: 0,
            pendingUploadStaleCount: 0,
          },
          thresholds: {
            errorRate5xx: 2,
            uploadFailureRate: 5,
            pendingStaleCount: 3,
            pendingStaleMinutes: 30,
          },
          breaches: {
            errorRate5xx: false,
            uploadFailureRate: false,
            pendingStaleCount: false,
          },
          context: {
            windowMinutes: 60,
            uploadWindowHours: 24,
          },
        });
      }
      if (url.includes('/api/admin/pharmacies/options')) {
        return jsonResponse({ data: [{ id: 1, name: 'テスト薬局', isActive: true }] });
      }
      if (url.includes('/api/admin/messages?page=1&limit=10')) {
        return jsonResponse({ data: [] });
      }
      if (url.includes('/api/health/openclaw')) {
        return jsonResponse({
          status: 'degraded',
          timestamp: '2026-03-29T10:00:00.000Z',
          connector: { configured: false, mode: 'managed_remote_agent' },
          webhook: { configured: false },
          retryQueue: { pending: 0, processing: 0, completed: 0, failed: 0 },
          handoffSuccessRate: null,
          lastHandoffAt: null,
          ddsAgent: {
            connected: false,
            agentId: null,
            lastSeenAt: null,
            queuedJobs: 0,
            awaitingUser: 0,
          },
        });
      }

      return jsonResponse({ error: 'Not found' }, 404);
    });

    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AdminDashboardPage />, {
      route: '/admin',
      authUser: mockAdminUser,
    });

    await waitFor(() => {
      expect(screen.getByText('管理者ダッシュボード')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText('要確認')).toBeInTheDocument();
    });

    expect(screen.getByText('未接続')).toBeInTheDocument();
    expect(screen.queryByText('一部のデータの取得に失敗しました')).not.toBeInTheDocument();
  });
});
