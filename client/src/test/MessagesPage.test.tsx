import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MessagesPage from '../pages/MessagesPage';
import { markThreadRead } from '../api/messages';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, name: 'テスト薬局', isAdmin: false },
  }),
}));

vi.mock('../api/messages', () => ({
  fetchThreads: vi.fn().mockResolvedValue({
    data: [{
      otherPharmacyId: 2,
      otherPharmacyName: '相手薬局',
      lastMessageBody: 'こんにちは',
      lastMessageAt: '2026-03-24T10:00:00.000Z',
      unreadCount: 1,
    }],
  }),
  fetchThread: vi.fn().mockResolvedValue({ data: [] }),
  sendMessage: vi.fn().mockResolvedValue({}),
  markThreadRead: vi.fn().mockResolvedValue({}),
}));

window.HTMLElement.prototype.scrollIntoView = vi.fn();

describe('MessagesPage', () => {
  it('uses document-level vertical scrolling instead of fixed-height inner scrolling', async () => {
    const { container } = render(<MessagesPage />);

    await waitFor(() => {
      expect(screen.getAllByText('相手薬局').length).toBeGreaterThan(0);
    });

    expect(container.querySelector('.overflow-auto')).toBeNull();
    expect(container.querySelector('[style*="calc(100vh - 60px)"]')).toBeNull();
  });

  it('dispatches sidebar refresh event after marking a thread as read', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    render(<MessagesPage />);

    fireEvent.click((await screen.findAllByText('相手薬局'))[0]);

    await waitFor(() => {
      expect(markThreadRead).toHaveBeenCalledWith(2);
    });
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'dss:messages-updated' }));
  });
});
