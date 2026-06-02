import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminOpenClawCommandsPage from '../../pages/admin/AdminOpenClawCommandsPage';
import { mockAdminUser, renderWithProviders } from '../helpers';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AdminOpenClawCommandsPage', () => {
  it('keeps edit as the row primary action and hides delete in the secondary menu', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/admin/openclaw-commands')) {
        return jsonResponse({
          data: [{
            id: 7,
            commandName: 'sync_inventory',
            category: 'inventory',
            descriptionJa: '在庫同期',
            isEnabled: true,
            parametersSchema: null,
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
          }],
        });
      }

      return jsonResponse({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AdminOpenClawCommandsPage />, {
      route: '/admin/openclaw-commands',
      authUser: mockAdminUser,
    });

    await waitFor(() => {
      expect(screen.getByText('sync_inventory')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: '編集' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '削除' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'その他' }));

    expect(screen.getByRole('button', { name: '削除' })).toBeInTheDocument();
  });
});
