import { screen, waitFor } from '@testing-library/react';
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
    renderWithProviders(<BookmarksPage />, { route: '/bookmarks', authUser: mockUser });

    await waitFor(() => {
      expect(screen.getByText('ブックマーク')).toBeInTheDocument();
    });

    expect(screen.getAllByRole('link', { name: 'マッチングへ' })[0]).toHaveAttribute('href', '/matching');
    expect(screen.getByRole('link', { name: 'マッチング一覧' })).toHaveAttribute('href', '/proposals');
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
      expect(screen.getByRole('link', { name: '候補を見る' })).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: '候補を見る' })).toHaveAttribute('href', '/matching?targetPharmacyId=22');
  });
});
