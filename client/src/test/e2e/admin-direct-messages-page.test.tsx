import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminDirectMessagesPage from '../../pages/admin/AdminDirectMessagesPage';
import { mockAdminUser, renderWithProviders } from '../helpers';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AdminDirectMessagesPage', () => {
  it('shows direct message threads and the selected conversation', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/admin/direct-messages/threads')) {
        return jsonResponse({
          data: [
            {
              pharmacyAId: 1,
              pharmacyAName: 'あおば薬局',
              pharmacyBId: 2,
              pharmacyBName: 'みどり薬局',
              lastMessage: '在庫ありますか？',
              lastMessageAt: '2026-03-24T09:00:00.000Z',
              messageCount: 4,
            },
            {
              pharmacyAId: 3,
              pharmacyAName: 'ひかり薬局',
              pharmacyBId: 4,
              pharmacyBName: 'さくら薬局',
              lastMessage: '本日発送します',
              lastMessageAt: '2026-03-24T08:30:00.000Z',
              messageCount: 2,
            },
          ],
          pagination: {
            page: 1,
            limit: 20,
            total: 2,
            totalPages: 1,
          },
        });
      }

      if (url.includes('/api/admin/direct-messages/thread?pharmacyAId=1&pharmacyBId=2')) {
        return jsonResponse({
          thread: {
            pharmacyAId: 1,
            pharmacyAName: 'あおば薬局',
            pharmacyBId: 2,
            pharmacyBName: 'みどり薬局',
          },
          data: [
            {
              id: 11,
              fromPharmacyId: 2,
              toPharmacyId: 1,
              body: 'はい、あります',
              isRead: true,
              createdAt: '2026-03-24T09:05:00.000Z',
            },
            {
              id: 10,
              fromPharmacyId: 1,
              toPharmacyId: 2,
              body: '在庫ありますか？',
              isRead: true,
              createdAt: '2026-03-24T09:00:00.000Z',
            },
          ],
          pagination: {
            page: 1,
            limit: 100,
            total: 2,
            totalPages: 1,
          },
        });
      }

      if (url.includes('/api/admin/direct-messages/thread?pharmacyAId=3&pharmacyBId=4')) {
        return jsonResponse({
          thread: {
            pharmacyAId: 3,
            pharmacyAName: 'ひかり薬局',
            pharmacyBId: 4,
            pharmacyBName: 'さくら薬局',
          },
          data: [
            {
              id: 21,
              fromPharmacyId: 3,
              toPharmacyId: 4,
              body: '本日発送します',
              isRead: false,
              createdAt: '2026-03-24T08:30:00.000Z',
            },
          ],
          pagination: {
            page: 1,
            limit: 100,
            total: 1,
            totalPages: 1,
          },
        });
      }

      return jsonResponse({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<AdminDirectMessagesPage />, {
      route: '/admin/direct-messages',
      authUser: mockAdminUser,
    });

    await waitFor(() => {
      expect(screen.getByText('ユーザー間メッセージ確認')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('あおば薬局')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('在庫ありますか？')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /ひかり薬局/ }));

    await waitFor(() => {
      expect(screen.getByText('ひかり薬局 ↔ さくら薬局')).toBeInTheDocument();
    });
    expect(screen.getAllByText('本日発送します').length).toBeGreaterThan(0);
  });
});
