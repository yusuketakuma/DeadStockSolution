import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminLogCenterPage from '../../pages/admin/AdminLogCenterPage';
import { LogEntriesView } from '../../pages/admin/components/AdminLogCenterLogEntriesView';
import { LogDetailModal, getActionStatusAlertVariant } from '../../pages/admin/components/AdminLogCenterLogDetailModal';
import type { NormalizedLogEntry } from '../../types/admin-log-center';
import { mockAdminUser, renderWithProviders } from '../helpers';

const longMessage = '非常に長いログメッセージ'.repeat(20);
const longImprovement = '改善案テキスト'.repeat(20);
const longCodeLocation = 'server/src/services/really/deep/path/'.concat('very-long-symbol-name_'.repeat(12));
const longDetail = 'long-detail-'.repeat(60);

const sampleEntry: NormalizedLogEntry = {
  id: 101,
  source: 'system_events',
  level: 'error',
  category: 'runtime_error',
  errorCode: 'ERR_TEST',
  message: longMessage,
  detail: longDetail,
  pharmacyId: 1,
  timestamp: '2026-03-25T10:00:00.000Z',
  whatHappened: longMessage,
  codeLocation: longCodeLocation,
  improvementSuggestion: longImprovement,
  tenant: {
    pharmacyId: 1,
    pharmacyName: 'テスト薬局',
    pharmacyEmail: 'test@example.com',
    tenantLabel: 'テスト薬局 (test@example.com)',
  },
  errorCodeMeta: null,
  operatorState: {
    status: 'new',
    note: null,
    updatedAt: null,
    updatedBy: null,
  },
};

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AdminLogCenterPage feedback helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/admin/log-center?')) {
        return jsonResponse({
          data: [sampleEntry],
          pagination: { page: 1, totalPages: 1, total: 1, limit: 50 },
        });
      }
      if (url.includes('/api/admin/log-center/status-history')) {
        return jsonResponse({ source: 'system_events', logId: 101, history: [] });
      }
      return jsonResponse({});
    }));
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({
      matches: false,
      media: '(max-width: 991.98px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps success and error states without relying on message text', () => {
    expect(getActionStatusAlertVariant('success')).toBe('success');
    expect(getActionStatusAlertVariant('error')).toBe('warning');
    expect(getActionStatusAlertVariant('info')).toBe('info');
  });

  it('applies wrapping classes to long log rows in the desktop table', async () => {
    const { container } = render(<LogEntriesView sourceFilter="" insights={null} />);

    await waitFor(() => {
      expect(screen.queryByText('ログ #101')).not.toBeInTheDocument();
      expect(screen.getByText(/ERR_TEST/)).toBeInTheDocument();
    });

    expect(container.querySelector('.dl-log-center-table')).toBeTruthy();
    expect(screen.getByTitle(longMessage)).toHaveClass('dl-log-center-cell--headline');
    expect(screen.getByTitle(longCodeLocation)).toHaveClass('dl-log-center-code');
  });

  it('keeps long code locations and detail json wrapped inside the detail modal', async () => {
    render(
      <LogDetailModal
        entry={sampleEntry}
        insight={null}
        show
        onHide={() => undefined}
        onStatusChanged={() => undefined}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('ログ詳細 #101')).toBeInTheDocument();
    });

    expect(screen.getByTitle(longCodeLocation)).toHaveClass('dl-log-center-code');
    expect(screen.getByText(longDetail).closest('pre')).toHaveClass('dl-log-center-detail-json');
  });

  it('shows active filters and can clear local filter controls', async () => {
    render(<LogEntriesView sourceFilter="system_events" insights={null} />);

    await waitFor(() => {
      expect(screen.getByText(/ソース: システムイベント/)).toBeInTheDocument();
    });

    await userEvent.selectOptions(screen.getByLabelText('レベルで絞り込み'), 'error');
    await userEvent.type(screen.getByPlaceholderText('メッセージ / カテゴリ / エラーコードで検索'), 'ERR_TEST');

    await waitFor(() => {
      expect(screen.getByText('レベル: Error')).toBeInTheDocument();
      expect(screen.getByText('検索: ERR_TEST')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: '条件をクリア' }));

    await waitFor(() => {
      expect(screen.queryByText('レベル: Error')).not.toBeInTheDocument();
      expect(screen.queryByText('検索: ERR_TEST')).not.toBeInTheDocument();
    });
  });

  it('renders nearby links for standalone error-code and quality follow-up', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/admin/log-center/summary')) {
        return jsonResponse({
          totalLogs: 1,
          totalErrors: 1,
          totalWarnings: 0,
          impactedTenants: 1,
          sourceBreakdown: [],
          latestLogAt: '2026-04-02T00:00:00.000Z',
        });
      }
      if (url.includes('/api/admin/log-center/insights')) {
        return jsonResponse({ topIssues: [] });
      }
      if (url.includes('/api/admin/log-center?')) {
        return jsonResponse({
          data: [sampleEntry],
          pagination: { page: 1, totalPages: 1, total: 1, limit: 50 },
        });
      }
      if (url.includes('/api/admin/log-center/status-history')) {
        return jsonResponse({ source: 'system_events', logId: 101, history: [] });
      }
      if (url.includes('/api/admin/error-codes')) {
        return jsonResponse({ items: [] });
      }
      return jsonResponse({});
    }));

    renderWithProviders(<AdminLogCenterPage />, {
      route: '/admin/log-center',
      authUser: mockAdminUser,
    });

    await waitFor(() => {
      expect(screen.getByText('ログセンター')).toBeInTheDocument();
    });

    expect(screen.getAllByRole('link', { name: 'エラーコードを管理' })[0]).toHaveAttribute('href', '/admin/error-codes');
    expect(screen.getByRole('link', { name: 'アップロード品質' })).toHaveAttribute('href', '/admin/upload-quality');
  });
});
