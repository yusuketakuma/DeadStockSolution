import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import ProposalDetailPage from '../../pages/ProposalDetailPage';
import type { ProposalTimelineEvent } from '../../utils/proposal-timeline';
import { mockUser, renderWithProviders } from '../helpers';

interface ProposalCommentMock {
  id: number;
  proposalId: number;
  authorPharmacyId: number;
  authorName: string;
  body: string;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

type ProposalTimelineEventMock = ProposalTimelineEvent;

interface ProposalDetailFetchOptions {
  status?: string;
  timeline?: ProposalTimelineEventMock[];
}

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

function createProposalDetailFetch(
  commentsState: ProposalCommentMock[],
  options: ProposalDetailFetchOptions = {},
) {
  const detail = {
    proposal: {
      id: 1,
      pharmacyAId: 1,
      pharmacyBId: 2,
      status: options.status ?? 'confirmed',
      totalValueA: 1000,
      totalValueB: 1000,
      valueDifference: 0,
      proposedAt: '2026-03-01T00:00:00.000Z',
    },
    items: [],
    pharmacyA: {
      id: 1,
      name: 'テスト薬局',
      phone: '090',
      fax: '03',
      address: 'A',
      prefecture: '東京都',
    },
    pharmacyB: {
      id: 2,
      name: '相手薬局',
      phone: '080',
      fax: '04',
      address: 'B',
      prefecture: '神奈川県',
    },
    timeline: options.timeline,
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    if (url.includes('/api/auth/me')) {
      return new Response(JSON.stringify(mockUser), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/api/exchange/proposals/1/comments') && method === 'GET') {
      return new Response(JSON.stringify({ data: commentsState }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/api/exchange/proposals/1/comments/101') && method === 'PATCH') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { body?: string };
      commentsState[0] = {
        ...commentsState[0],
        body: body.body ?? commentsState[0].body,
        updatedAt: '2026-03-03T00:00:00.000Z',
      };
      return new Response(JSON.stringify({ message: 'コメントを更新しました' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/api/exchange/proposals/1/comments/101') && method === 'DELETE') {
      commentsState[0] = {
        ...commentsState[0],
        body: '（削除済み）',
        isDeleted: true,
        updatedAt: '2026-03-03T00:00:00.000Z',
      };
      return new Response(JSON.stringify({ message: 'コメントを削除しました' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/api/exchange/proposals/1')) {
      return new Response(JSON.stringify(detail), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: `Unexpected mock route: ${method} ${url}` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ProposalDetailPage comment actions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setMatchMedia(false);
  });

  it('allows editing own comment', async () => {
    const commentsState: ProposalCommentMock[] = [
      {
        id: 101,
        proposalId: 1,
        authorPharmacyId: 1,
        authorName: 'テスト薬局',
        body: '元コメント',
        isDeleted: false,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
      },
      {
        id: 102,
        proposalId: 1,
        authorPharmacyId: 9,
        authorName: '相手薬局',
        body: '相手コメント',
        isDeleted: false,
        createdAt: '2026-03-01T01:00:00.000Z',
        updatedAt: '2026-03-01T01:00:00.000Z',
      },
    ];
    createProposalDetailFetch(commentsState);

    renderWithProviders(
      <Routes>
        <Route path="/proposals/:id" element={<ProposalDetailPage />} />
      </Routes>,
      { route: '/proposals/1' },
    );

    await waitFor(() => {
      expect(screen.getByText('元コメント')).toBeInTheDocument();
    });
    expect(screen.getByText('相手コメント')).toBeInTheDocument();

    const editButtons = screen.getAllByRole('button', { name: '編集' });
    expect(editButtons).toHaveLength(1);
    await userEvent.click(editButtons[0]);

    const editField = screen.getByLabelText('コメント編集');
    await userEvent.clear(editField);
    await userEvent.type(editField, '更新コメント');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(screen.getByText('コメントを更新しました')).toBeInTheDocument();
    });
    expect(screen.getByText('更新コメント')).toBeInTheDocument();
  });


  it('applies a comment template to the editor', async () => {
    const commentsState: ProposalCommentMock[] = [];
    createProposalDetailFetch(commentsState);

    renderWithProviders(
      <Routes>
        <Route path="/proposals/:id" element={<ProposalDetailPage />} />
      </Routes>,
      { route: '/proposals/1' },
    );

    await waitFor(() => {
      expect(screen.getByText('交渉メモ / コメント')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: '定型文1' }));

    expect((screen.getByLabelText('新規コメント') as HTMLTextAreaElement).value.length).toBeGreaterThan(0);
  });

  it('allows deleting own comment', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const commentsState: ProposalCommentMock[] = [
      {
        id: 101,
        proposalId: 1,
        authorPharmacyId: 1,
        authorName: 'テスト薬局',
        body: '削除対象コメント',
        isDeleted: false,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
      },
    ];
    createProposalDetailFetch(commentsState);

    renderWithProviders(
      <Routes>
        <Route path="/proposals/:id" element={<ProposalDetailPage />} />
      </Routes>,
      { route: '/proposals/1' },
    );

    await waitFor(() => {
      expect(screen.getByText('削除対象コメント')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: '削除' }));

    await waitFor(() => {
      expect(screen.getByText('コメントを削除しました')).toBeInTheDocument();
    });
    expect(screen.getByText('（削除済み）')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '編集' })).not.toBeInTheDocument();
  });
});

describe('ProposalDetailPage timeline', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setMatchMedia(false);
  });

  it('renders timeline events and filters decision actions', async () => {
    const commentsState: ProposalCommentMock[] = [];
    createProposalDetailFetch(commentsState, {
      status: 'completed',
      timeline: [
        {
          action: 'proposal_created',
          label: '仮マッチング作成',
          at: '2026-03-01T00:00:00.000Z',
          actorPharmacyId: 1,
          actorName: 'テスト薬局',
          statusFrom: null,
          statusTo: 'proposed',
        },
        {
          action: 'proposal_accept',
          label: '承認',
          at: '2026-03-01T00:10:00.000Z',
          actorPharmacyId: 2,
          actorName: '相手薬局',
          statusFrom: 'proposed',
          statusTo: 'confirmed',
        },
        {
          action: 'proposal_complete',
          label: '交換完了',
          at: '2026-03-01T01:00:00.000Z',
          actorPharmacyId: 1,
          actorName: 'テスト薬局',
          statusFrom: 'confirmed',
          statusTo: 'completed',
        },
      ],
    });

    renderWithProviders(
      <Routes>
        <Route path="/proposals/:id" element={<ProposalDetailPage />} />
      </Routes>,
      { route: '/proposals/1' },
    );

    await waitFor(() => {
      expect(document.getElementById('proposal-timeline')).not.toBeNull();
    });
    const timelineSection = document.getElementById('proposal-timeline');
    if (!timelineSection) throw new Error('timeline section not found');

    await waitFor(() => {
      expect(within(timelineSection).getByText('仮マッチング作成')).toBeInTheDocument();
    });

    await userEvent.selectOptions(within(timelineSection).getByLabelText('進行履歴フィルタ'), 'decision');

    expect(within(timelineSection).queryByText('仮マッチング作成')).not.toBeInTheDocument();
    expect(within(timelineSection).getByText('承認')).toBeInTheDocument();
    expect(within(timelineSection).getByText('交換完了')).toBeInTheDocument();
  });

  it('scrolls timeline section into view when opened from timeline hash link', async () => {
    const commentsState: ProposalCommentMock[] = [];
    const scrollIntoViewMock = vi.fn();
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoViewMock,
    });

    createProposalDetailFetch(commentsState, {
      timeline: [{
        action: 'proposal_created',
        label: '仮マッチング作成',
        at: '2026-03-01T00:00:00.000Z',
        actorPharmacyId: 1,
        actorName: 'テスト薬局',
        statusFrom: null,
        statusTo: 'proposed',
      }],
    });

    renderWithProviders(
      <Routes>
        <Route path="/proposals/:id" element={<ProposalDetailPage />} />
      </Routes>,
      { route: '/proposals/1#proposal-timeline' },
    );

    await waitFor(() => {
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    });
  });
});
