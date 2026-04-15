import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import InventoryBrowsePage from '../../pages/InventoryBrowsePage';

// InventorySearchForm depends on api.get for suggestions and BarcodeScanButton for camera
vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: vi.fn(async (path: string) => {
        if (path.startsWith('/inventory/browse?')) {
          return {
            data: [],
            pagination: { page: 1, totalPages: 0, total: 0 },
          };
        }
        if (path === '/search/drugs') {
          return [];
        }
        return [];
      }),
    },
  };
});

vi.mock('../../components/mobile/BarcodeScanButton', () => ({
  default: () => null,
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <InventoryBrowsePage />
    </MemoryRouter>,
  );
}

function RouteSyncHarness() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate('/inventory/browse?search=アスピリン')}>
        URLで検索条件を変更
      </button>
      <Routes>
        <Route path="/inventory/browse" element={<InventoryBrowsePage />} />
      </Routes>
    </>
  );
}

describe('InventoryBrowsePage', () => {
  it('shows the browse title and search input', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('全薬局の在庫参照')).toBeInTheDocument();
    });
    expect(screen.getAllByRole('link', { name: '検索条件を確認' }).some((link) => link.getAttribute('href') === '/inventory/search')).toBe(true);
    expect(screen.getAllByRole('link', { name: '候補を確認' }).some((link) => link.getAttribute('href') === '/matching')).toBe(true);
    expect(screen.getByPlaceholderText('薬品名で検索（ひらがな・カタカナ対応）...')).toBeInTheDocument();
  });

  it('shows the browse empty state when no items are returned', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('在庫データがありません')).toBeInTheDocument();
    });
    expect(screen.getAllByRole('link', { name: '検索条件を確認' }).some((link) => link.getAttribute('href') === '/inventory/search')).toBe(true);
  });

  it('reacts to later URL search param changes', async () => {
    render(
      <MemoryRouter initialEntries={['/inventory/browse']}>
        <RouteSyncHarness />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText('薬品名で検索（ひらがな・カタカナ対応）...')).toHaveValue('');
    });

    fireEvent.click(screen.getByRole('button', { name: 'URLで検索条件を変更' }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('薬品名で検索（ひらがな・カタカナ対応）...')).toHaveValue('アスピリン');
    });
    expect(screen.getByRole('link', { name: 'この条件で候補を確認' })).toHaveAttribute('href', '/matching?drug=%E3%82%A2%E3%82%B9%E3%83%94%E3%83%AA%E3%83%B3');
  });
});
