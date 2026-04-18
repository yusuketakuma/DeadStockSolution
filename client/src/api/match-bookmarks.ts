import { api } from './client';

export interface Bookmark {
  id: number;
  pharmacyId: number;
  candidatePharmacyId: number;
  candidatePharmacyName: string | null;
  drugCode: string;
  memo: string | null;
  createdAt: string;
}

export interface BookmarkListResponse {
  items: Bookmark[];
  page: number;
  limit: number;
}

export interface MatchingDismissStats {
  distance: number;
  expiry: number;
  value_gap: number;
  item_fit: number;
  other: number;
}

export const fetchBookmarksPage = (page: number, limit: number) =>
  api.get<BookmarkListResponse>(`/match-bookmarks?page=${page}&limit=${limit}`);

export const createBookmark = (data: {
  candidatePharmacyId: number;
  drugCode: string;
  memo?: string;
}) => api.post<Bookmark>('/match-bookmarks', data);

export const updateBookmarkMemo = (id: number, memo: string) =>
  api.patch<Bookmark>(`/match-bookmarks/${id}`, { memo });

export const deleteBookmark = (id: number) =>
  api.delete<{ ok: boolean }>(`/match-bookmarks/${id}`);

export const fetchMatchingDismissStats = () =>
  api.get<{ stats: MatchingDismissStats }>('/match-bookmarks/dismiss-feedback');

export const recordMatchingDismissFeedback = (data: {
  candidatePharmacyId: number;
  reason: keyof MatchingDismissStats;
  drugCodes?: string[];
}) => api.post<{ stats: MatchingDismissStats }>('/match-bookmarks/dismiss-feedback', data);
