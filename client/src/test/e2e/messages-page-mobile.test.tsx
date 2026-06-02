import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MessagesPage from '../../pages/MessagesPage';
import { mockUser, renderWithProviders } from '../helpers';

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

describe('MessagesPage - mobile layout', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setMatchMedia(true);
  });

  it('renders a mobile-first thread list and opens the detail pane', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/messages/threads')) {
        return jsonResponse({
          data: [{
            otherPharmacyId: 2,
            otherPharmacyName: '中央薬局',
            lastMessageBody: '確認お願いします',
            lastMessageAt: '2026-03-28T00:00:00.000Z',
            lastMessageSenderId: 2,
            unreadCount: 1,
            waitingOn: 'me',
            isOverdue: false,
            hasAttachments: true,
          }],
        });
      }
      if (url.includes('/api/messages/thread/2')) {
        return jsonResponse({
          data: [{
            id: 10,
            fromPharmacyId: 2,
            toPharmacyId: 1,
            body: '確認お願いします',
            isRead: false,
            readAt: null,
            isDeleted: false,
            createdAt: '2026-03-28T00:00:00.000Z',
            attachments: [],
          }],
          pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
        });
      }
      if (url.includes('/api/messages/thread/2/read')) {
        return jsonResponse({ markedCount: 1 });
      }
      if (url.includes('/api/messages/unread-count')) {
        return jsonResponse({ unreadCount: 1 });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<MessagesPage />, {
      route: '/messages',
      authUser: mockUser,
    });

    await waitFor(() => {
      expect(screen.getByText('薬局間メッセージ')).toBeInTheDocument();
    });

    expect(document.querySelector('.d-lg-none')).toBeInTheDocument();
    expect(screen.getAllByText('中央薬局').length).toBeGreaterThan(0);

    screen.getAllByText('中央薬局')[1]?.click();

    await waitFor(() => {
      expect(screen.getByText('確認お願いします')).toBeInTheDocument();
    });
    expect(screen.getAllByLabelText('メッセージ本文').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: '定型文を挿入' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'ありがとうございます。内容を確認して折り返します。' })).not.toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: '定型文を挿入' }).at(-1)!);

    expect(screen.getByRole('button', { name: 'ありがとうございます。内容を確認して折り返します。' })).toBeInTheDocument();
  });
});
