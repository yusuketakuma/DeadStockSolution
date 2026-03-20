import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

describe('InventoryBrowsePage', () => {
  it('shows the browse title and search input', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('全薬局の在庫参照')).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText('薬品名で検索（ひらがな・カタカナ対応）...')).toBeInTheDocument();
  });

  it('shows the browse empty state when no items are returned', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('在庫データがありません')).toBeInTheDocument();
    });
  });
});
