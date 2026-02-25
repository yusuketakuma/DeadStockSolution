import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DeadStockListPage from '../../pages/DeadStockListPage';
import UsedMedicationListPage from '../../pages/UsedMedicationListPage';
import InventoryBrowsePage from '../../pages/InventoryBrowsePage';
import { renderWithProviders, mockUser } from '../helpers';

function createMockFetch(routes: Record<string, unknown>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();

    for (const [path, data] of Object.entries(routes)) {
      if (url.includes(path)) {
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('DeadStockListPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders with dead stock items', async () => {
    createMockFetch({
      '/api/auth/me': mockUser,
      '/api/inventory/dead-stock': {
        data: [
          {
            id: 1,
            drugName: 'アムロジピン錠5mg',
            drugCode: '2171014F1020',
            quantity: 100,
            unit: '錠',
            yakkaUnitPrice: 10.1,
            yakkaTotal: 1010,
            expirationDate: '2027-06',
            lotNumber: 'LOT001',
            isAvailable: true,
          },
          {
            id: 2,
            drugName: 'ロキソプロフェン錠60mg',
            drugCode: '1149019F1234',
            quantity: 50,
            unit: '錠',
            yakkaUnitPrice: 5.7,
            yakkaTotal: 285,
            expirationDate: '2026-12',
            lotNumber: 'LOT002',
            isAvailable: true,
          },
        ],
        pagination: { page: 1, totalPages: 1, total: 2 },
      },
    });

    renderWithProviders(<DeadStockListPage />);

    await waitFor(() => {
      expect(screen.getByText('デッドストックリスト (2件)')).toBeInTheDocument();
    });

    expect(screen.getByText('アムロジピン錠5mg')).toBeInTheDocument();
    expect(screen.getByText('ロキソプロフェン錠60mg')).toBeInTheDocument();
  });

  it('shows table headers correctly', async () => {
    createMockFetch({
      '/api/auth/me': mockUser,
      '/api/inventory/dead-stock': {
        data: [{
          id: 1, drugName: 'テスト薬', drugCode: 'CODE1',
          quantity: 10, unit: '錠', yakkaUnitPrice: 100, yakkaTotal: 1000,
          expirationDate: '2027-01', lotNumber: 'L1', isAvailable: true,
        }],
        pagination: { page: 1, totalPages: 1, total: 1 },
      },
    });

    renderWithProviders(<DeadStockListPage />);

    await waitFor(() => {
      expect(screen.getByText('薬品名')).toBeInTheDocument();
    });
    expect(screen.getByText('コード')).toBeInTheDocument();
    expect(screen.getByText('数量')).toBeInTheDocument();
    expect(screen.getByText('単位')).toBeInTheDocument();
    expect(screen.getByText('薬価(単価)')).toBeInTheDocument();
    expect(screen.getByText('薬価(合計)')).toBeInTheDocument();
    expect(screen.getByText('使用期限')).toBeInTheDocument();
    expect(screen.getByText('ロット')).toBeInTheDocument();
  });

  it('shows empty state when no dead stock items', async () => {
    createMockFetch({
      '/api/auth/me': mockUser,
      '/api/inventory/dead-stock': {
        data: [],
        pagination: { page: 1, totalPages: 0, total: 0 },
      },
    });

    renderWithProviders(<DeadStockListPage />);

    await waitFor(() => {
      expect(screen.getByText(/デッドストックデータがありません/)).toBeInTheDocument();
    });
  });

  it('has upload link', async () => {
    createMockFetch({
      '/api/auth/me': mockUser,
      '/api/inventory/dead-stock': {
        data: [],
        pagination: { page: 1, totalPages: 0, total: 0 },
      },
    });

    renderWithProviders(<DeadStockListPage />);

    await waitFor(() => {
      const uploadLink = screen.getByRole('link', { name: 'アップロード' });
      expect(uploadLink).toBeInTheDocument();
      expect(uploadLink).toHaveAttribute('href', '/upload');
    });
  });

  it('has delete button for each item', async () => {
    createMockFetch({
      '/api/auth/me': mockUser,
      '/api/inventory/dead-stock': {
        data: [{
          id: 1, drugName: 'テスト薬', drugCode: 'CODE1',
          quantity: 10, unit: '錠', yakkaUnitPrice: 100, yakkaTotal: 1000,
          expirationDate: '2027-01', lotNumber: 'L1', isAvailable: true,
        }],
        pagination: { page: 1, totalPages: 1, total: 1 },
      },
    });

    renderWithProviders(<DeadStockListPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '削除' })).toBeInTheDocument();
    });
  });

  it('calls delete API when delete button is clicked', async () => {
    const user = userEvent.setup();

    const fetchMock = createMockFetch({
      '/api/auth/me': mockUser,
      '/api/inventory/dead-stock': {
        data: [{
          id: 1, drugName: 'テスト薬', drugCode: 'CODE1',
          quantity: 10, unit: '錠', yakkaUnitPrice: 100, yakkaTotal: 1000,
          expirationDate: '2027-01', lotNumber: 'L1', isAvailable: true,
        }],
        pagination: { page: 1, totalPages: 1, total: 1 },
      },
    });

    renderWithProviders(<DeadStockListPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '削除' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: '削除' }));
    await user.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => {
      const deleteCall = fetchMock.mock.calls.find(
        (call) => {
          const url = typeof call[0] === 'string' ? call[0] : call[0].toString();
          return url.includes('/api/inventory/dead-stock/1') &&
            (call[1] as RequestInit)?.method === 'DELETE';
        }
      );
      expect(deleteCall).toBeTruthy();
    });
  });
});

describe('UsedMedicationListPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders with used medication items', async () => {
    createMockFetch({
      '/api/auth/me': mockUser,
      '/api/inventory/used-medication': {
        data: [
          {
            id: 1,
            drugName: 'アムロジピン錠5mg',
            drugCode: '2171014F1020',
            monthlyUsage: 200,
            unit: '錠',
            yakkaUnitPrice: 10.1,
          },
        ],
        pagination: { page: 1, totalPages: 1, total: 1 },
      },
    });

    renderWithProviders(<UsedMedicationListPage />);

    await waitFor(() => {
      expect(screen.getByText('アムロジピン錠5mg')).toBeInTheDocument();
    });
  });
});

describe('InventoryBrowsePage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the inventory browse page', async () => {
    createMockFetch({
      '/api/auth/me': mockUser,
      '/api/inventory/browse': {
        data: [],
        pagination: { page: 1, totalPages: 0, total: 0 },
      },
    });

    renderWithProviders(<InventoryBrowsePage />);

    await waitFor(() => {
      expect(screen.getByText('全薬局の在庫参照')).toBeInTheDocument();
    });
    expect(screen.getByText('在庫データがありません')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('薬品名で検索（ひらがな・カタカナ対応）...')).toBeInTheDocument();
  });
});
