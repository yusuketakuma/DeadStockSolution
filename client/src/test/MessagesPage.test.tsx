import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MessagesPage from '../pages/MessagesPage';
import { fetchThreads, fetchThread, markThreadRead } from '../api/messages';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, name: 'テスト薬局', isAdmin: false },
  }),
}));

vi.mock('../api/messages', () => ({
  fetchThreads: vi.fn(),
  fetchThread: vi.fn(),
  sendMessage: vi.fn().mockResolvedValue({}),
  markThreadRead: vi.fn().mockResolvedValue({}),
}));

window.HTMLElement.prototype.scrollIntoView = vi.fn();

describe('MessagesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchThreads).mockResolvedValue({
      data: [{
        otherPharmacyId: 2,
        otherPharmacyName: '相手薬局',
        lastMessageBody: 'こんにちは',
        lastMessageAt: '2026-03-24T10:00:00.000Z',
        lastMessageSenderId: 2,
        unreadCount: 1,
        waitingOn: null,
        isOverdue: false,
        hasAttachments: false,
      }],
    });
    vi.mocked(fetchThread).mockResolvedValue({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
  });

  it('shows a thread list skeleton while loading threads', () => {
    vi.mocked(fetchThreads).mockImplementation(() => new Promise(() => {}));

    render(
      <MemoryRouter initialEntries={['/messages']}>
        <MessagesPage />
      </MemoryRouter>,
    );

    expect(screen.getAllByLabelText('スレッド一覧を読み込み中').length).toBeGreaterThan(0);
  });

  it('shows an empty state when there are no threads', async () => {
    vi.mocked(fetchThreads).mockResolvedValue({ data: [] });

    render(
      <MemoryRouter initialEntries={['/messages']}>
        <MessagesPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('メッセージはありません').length).toBeGreaterThan(0);
    });
  });

  it('uses document-level vertical scrolling instead of fixed-height inner scrolling', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/messages']}>
        <MessagesPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('相手薬局').length).toBeGreaterThan(0);
    });

    expect(container.querySelector('.overflow-auto')).toBeNull();
    expect(container.querySelector('[style*="calc(100vh - 60px)"]')).toBeNull();
  });

  it('dispatches sidebar refresh event after marking a thread as read', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    render(
      <MemoryRouter initialEntries={['/messages']}>
        <MessagesPage />
      </MemoryRouter>,
    );

    fireEvent.click((await screen.findAllByText('相手薬局'))[0]);

    await waitFor(() => {
      expect(markThreadRead).toHaveBeenCalledWith(2);
    });
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'dss:messages-updated' }));
  });
});
