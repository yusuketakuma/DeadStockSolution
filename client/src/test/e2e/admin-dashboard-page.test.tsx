import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    const user = userEvent.setup();
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
          escalatedRequests24h: 0,
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
      if (url.includes('/api/admin/cron-status')) {
        return jsonResponse({
          crons: [
            {
              name: 'daily_statistics',
              label: '日次統計集計',
              lastActivityAt: '2026-03-29T09:00:00.000Z',
              evidenceNote: 'daily_statistics テーブルの最終レコード作成日時',
            },
          ],
        });
      }
      if (url.includes('/api/admin/slo-breaches?limit=5')) {
        return jsonResponse({
          data: [
            {
              id: 1,
              type: 'rate_limit',
              details: 'admin notifications endpoint exceeded threshold',
              timestamp: '2026-03-29T09:30:00.000Z',
            },
          ],
          total: 1,
        });
      }
      if (url.includes('/api/admin/dashboard-trends')) {
        return jsonResponse({
          current: {
            totalUploads: 33,
            totalExchanges: 7,
            unreadNotifications: 0,
            failedUploadJobs24h: 0,
            pendingProposalActions24h: 0,
            escalatedRequests24h: 0,
          },
          previous: {
            totalUploads: 30,
            totalExchanges: 6,
            unreadNotifications: 1,
            failedUploadJobs24h: 1,
            pendingProposalActions24h: 2,
            escalatedRequests24h: 1,
            createdAt: '2026-03-28T10:00:00.000Z',
          },
          average: {
            totalUploads: 28,
            totalExchanges: 5,
            unreadNotifications: 1,
            failedUploadJobs24h: 1,
            pendingProposalActions24h: 2,
            escalatedRequests24h: 0,
          },
          spikes: {
            failedUploadJobs24h: false,
            pendingProposalActions24h: false,
            unreadNotifications: false,
          },
        });
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

    expect(screen.getByText('緊急監視サマリー')).toBeInTheDocument();
    expect(screen.getByText('運用監視')).toBeInTheDocument();
    expect(screen.getByText('事業サマリー')).toBeInTheDocument();
    expect(screen.getByText('運用連絡')).toBeInTheDocument();
    await waitFor(() => {
    expect(screen.getAllByText('要確認').length).toBeGreaterThan(0);
    });

    expect(screen.getByText('未接続')).toBeInTheDocument();
    expect(screen.getByText('CRON ステータス')).toBeInTheDocument();
    expect(screen.getByText('日次統計集計')).toBeInTheDocument();
    expect(screen.getByText('SLO 違反履歴')).toBeInTheDocument();
    expect(screen.getByText('今見る運用')).toBeInTheDocument();
    expect(screen.getByText('薬局運用・承認')).toBeInTheDocument();
    expect(screen.getByText('マッチング・マスター')).toBeInTheDocument();
    expect(screen.getByText('監査・保守')).toBeInTheDocument();
    expect(screen.getByText('admin notifications endpoint exceeded threshold')).toBeInTheDocument();
    expect(
      screen.getAllByRole('link', { name: 'ログセンター' }).every((link) => link.getAttribute('href') === '/admin/log-center'),
    ).toBe(true);
    const matchingMasterCard = screen.getByText('マッチング・マスター').closest('.border');
    expect(matchingMasterCard).not.toBeNull();
    const matchingMasterScope = within(matchingMasterCard as HTMLElement);
    await user.click(matchingMasterScope.getByRole('button', { name: '関連画面' }));
    expect(matchingMasterScope.getByRole('link', { name: 'マッチング性能' })).toHaveAttribute('href', '/admin/matching-performance');
    expect(matchingMasterScope.getByRole('link', { name: '薬品同等性' })).toHaveAttribute('href', '/admin/drug-equivalences');

    const maintenanceCard = screen.getByText('監査・保守').closest('.border');
    expect(maintenanceCard).not.toBeNull();
    const maintenanceScope = within(maintenanceCard as HTMLElement);
    await user.click(maintenanceScope.getByRole('button', { name: '関連画面' }));
    expect(maintenanceScope.getByRole('link', { name: 'エラーコード' })).toHaveAttribute('href', '/admin/error-codes');
    expect(maintenanceScope.getByRole('link', { name: '監査ログ' })).toHaveAttribute('href', '/admin/audit');
    expect(maintenanceScope.getByRole('link', { name: '操作ログ' })).toHaveAttribute('href', '/admin/logs');
    expect(maintenanceScope.getByRole('link', { name: 'レート制限設定' })).toHaveAttribute('href', '/admin/rate-limits');

    const pharmacyOpsCard = screen.getByText('薬局運用・承認').closest('.border');
    expect(pharmacyOpsCard).not.toBeNull();
    const pharmacyOpsScope = within(pharmacyOpsCard as HTMLElement);
    await user.click(pharmacyOpsScope.getByRole('button', { name: '関連画面' }));
    expect(pharmacyOpsScope.getByRole('link', { name: '営業時間' })).toHaveAttribute('href', '/admin/business-hours');
    expect(pharmacyOpsScope.getByRole('link', { name: '関係性監査' })).toHaveAttribute('href', '/admin/relationships');
    expect(pharmacyOpsScope.getByRole('link', { name: '薬局ヘルス' })).toHaveAttribute('href', '/admin/pharmacy-health');
    expect(screen.queryByText('一部のデータの取得に失敗しました')).not.toBeInTheDocument();
  });
});
