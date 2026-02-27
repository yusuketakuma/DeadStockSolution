import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, type MemoryRouterProps } from 'react-router-dom';
import App from '../../App';
import { mockUser } from '../helpers';

function renderAppAtRoute(route: string) {
  const routerProps: MemoryRouterProps = {
    initialEntries: [route],
    future: { v7_startTransition: true, v7_relativeSplatPath: true },
  };

  return render(
    <MemoryRouter {...routerProps}>
      <App />
    </MemoryRouter>,
  );
}

function createPrintPayload() {
  return {
    proposal: {
      id: 1,
      pharmacyAId: 1,
      pharmacyBId: 2,
      totalValueA: 1200,
      totalValueB: 800,
      proposedAt: '2026-02-01T09:00:00Z',
    },
    items: [
      {
        id: 1,
        fromPharmacyId: 1,
        toPharmacyId: 2,
        quantity: 10,
        yakkaValue: 1200,
        drugName: 'テスト薬',
        unit: '錠',
        yakkaUnitPrice: 120,
      },
      {
        id: 2,
        fromPharmacyId: 2,
        toPharmacyId: 1,
        quantity: 8,
        yakkaValue: 800,
        drugName: '別テスト薬',
        unit: '錠',
        yakkaUnitPrice: 100,
      },
    ],
    pharmacyA: {
      name: 'テスト薬局東京店',
      phone: '03-0000-0001',
      fax: '03-0000-0002',
      address: '千代田1-1-1',
      prefecture: '東京都',
      licenseNumber: 'A-123',
    },
    pharmacyB: {
      name: 'テスト薬局大阪店',
      phone: '06-0000-0001',
      fax: '06-0000-0002',
      address: '北区1-1-1',
      prefecture: '大阪府',
      licenseNumber: 'B-456',
    },
  };
}

function mockFetchForRoutes(user: typeof mockUser | null, route: string) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.includes('/api/auth/me')) {
      if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(user), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (route === '/proposals/1/print' && url.includes('/api/exchange/proposals/1/print')) {
      return new Response(JSON.stringify(createPrintPayload()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/api/upload/status')) {
      return new Response(JSON.stringify({
        deadStockUploaded: true,
        usedMedicationUploaded: true,
        lastDeadStockUpload: '2026-01-15T10:00:00Z',
        lastUsedMedicationUpload: '2026-01-16T10:00:00Z',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/api/notifications')) {
      return new Response(JSON.stringify({
        notices: [],
        summary: { unreadMessages: 0, actionableRequests: 0, total: 0 },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }));
}

describe('Route meta integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('redirects authenticated user away from public login route', async () => {
    mockFetchForRoutes(mockUser, '/login');
    const { container } = renderAppAtRoute('/login');

    await waitFor(() => {
      const heading = container.querySelector('h4.page-title');
      expect(heading?.textContent).toBe('ダッシュボード');
    });
  });

  it('redirects non-admin user away from admin route', async () => {
    mockFetchForRoutes(mockUser, '/admin');
    const { container } = renderAppAtRoute('/admin');

    await waitFor(() => {
      const heading = container.querySelector('h4.page-title');
      expect(heading?.textContent).toBe('ダッシュボード');
    });
    expect(screen.queryByText('管理者ダッシュボード')).not.toBeInTheDocument();
  });

  it('renders print route without main layout wrapper', async () => {
    mockFetchForRoutes(mockUser, '/proposals/1/print');
    const { container } = renderAppAtRoute('/proposals/1/print');

    await waitFor(() => {
      expect(screen.getByText('医薬品交換様式（FAX確認用）')).toBeInTheDocument();
    });

    expect(container.querySelector('.app-header')).toBeNull();
    expect(container.querySelector('.sidebar-desktop')).toBeNull();
  });

  it('redirects unknown route to dashboard', async () => {
    mockFetchForRoutes(mockUser, '/unknown-route');
    const { container } = renderAppAtRoute('/unknown-route');

    await waitFor(() => {
      const heading = container.querySelector('h4.page-title');
      expect(heading?.textContent).toBe('ダッシュボード');
    });
  });

  it('redirects unauthenticated user from protected route to login', async () => {
    mockFetchForRoutes(null, '/');
    renderAppAtRoute('/');

    await waitFor(() => {
      expect(screen.getByText('薬局ログイン')).toBeInTheDocument();
    });
  });

  it('redirects unauthenticated user from admin route to login', async () => {
    mockFetchForRoutes(null, '/admin');
    renderAppAtRoute('/admin');

    await waitFor(() => {
      expect(screen.getByText('薬局ログイン')).toBeInTheDocument();
    });
  });
});
