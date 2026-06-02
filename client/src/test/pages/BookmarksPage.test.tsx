import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BookmarksPage from '../../pages/BookmarksPage';
import { renderWithProviders, mockUser } from '../helpers';

vi.mock('../../api/match-bookmarks', () => ({
  fetchBookmarksPage: vi.fn(),
  deleteBookmark: vi.fn(),
  updateBookmarkMemo: vi.fn(),
}));

import { fetchBookmarksPage } from '../../api/match-bookmarks';

describe('BookmarksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchBookmarksPage).mockResolvedValue({
      items: [],
      page: 1,
      limit: 20,
    });
  });

  it('renders header shortcuts to matching and proposals', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BookmarksPage />, { route: '/bookmarks', authUser: mockUser });

    await waitFor(() => {
      expect(screen.getByText('ブックマーク')).toBeInTheDocument();
    });

    const nextActionCard = screen.getByText('次にやること').closest('.card');
    expect(nextActionCard).not.toBeNull();
    const nextActionScope = within(nextActionCard as HTMLElement);

    expect(nextActionScope.getByRole('link', { name: '候補を探す' })).toHaveAttribute('href', '/matching');
    await user.click(nextActionScope.getByRole('button', { name: '関連' }));
    expect(nextActionScope.getByRole('link', { name: '提案一覧を確認' })).toHaveAttribute('href', '/proposals');
  });

  it('links saved bookmarks back to matching candidates', async () => {
    vi.mocked(fetchBookmarksPage).mockResolvedValue({
      items: [{
        id: 1,
        pharmacyId: 1,
        candidatePharmacyId: 22,
        candidatePharmacyName: '候補薬局',
        drugCode: 'ABC-001',
        memo: null,
        createdAt: '2026-03-28T00:00:00.000Z',
      }],
      page: 1,
      limit: 20,
    });

    renderWithProviders(<BookmarksPage />, { route: '/bookmarks', authUser: mockUser });

    await waitFor(() => {
      expect(screen.getByRole('link', { name: '候補を確認' })).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: '候補を確認' })).toHaveAttribute('href', '/matching?targetPharmacyId=22');
  });
});
