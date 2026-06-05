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
  timeline?: Omit<ProposalTimelineEventMock, 'eventType'>[];
  items?: Array<Record<string, unknown>>;
  counterOffers?: Array<Record<string, unknown>>;
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
    items: options.items ?? [],
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
    enrichedTimeline: options.timeline?.map((e) => ({ ...e, eventType: 'status_change' as const })),
    counterOffers: options.counterOffers,
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
    if (url.includes('/api/exchange/proposals/1/counter-offers/') && url.includes('/respond') && method === 'POST') {
      return new Response(JSON.stringify({ message: '反対提案に応答しました' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
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

  it('renders navigation links back to proposals and exchange history', async () => {
    const user = userEvent.setup();
    createProposalDetailFetch([]);

    renderWithProviders(
      <Routes>
        <Route path="/proposals/:id" element={<ProposalDetailPage />} />
      </Routes>,
      { route: '/proposals/1' },
    );

    await waitFor(() => {
      expect(screen.getByText('マッチング #1')).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: '一覧の状態で戻る' })).toHaveAttribute('href', '/proposals');
    await user.click(screen.getByRole('button', { name: '関連画面' }));
    expect(screen.getByRole('link', { name: '提案一覧を確認' })).toHaveAttribute('href', '/proposals');
    expect(screen.getByRole('link', { name: '交換履歴を確認' })).toHaveAttribute('href', '/exchange-history');
    expect(screen.getByRole('link', { name: '印刷ページを確認' })).toHaveAttribute('href', '/proposals/1/print');
  });

  it('keeps proposals and history reachable when loading the detail fails', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify(mockUser), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/exchange/proposals/1/comments')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/exchange/proposals/1')) {
        return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: `Unexpected mock route: ${url}` }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(
      <Routes>
        <Route path="/proposals/:id" element={<ProposalDetailPage />} />
      </Routes>,
      { route: '/proposals/1' },
    );

    await waitFor(() => {
      expect(screen.getByText('提案詳細')).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: '提案一覧を確認' })).toHaveAttribute('href', '/proposals');
    await user.click(screen.getByRole('button', { name: '関連画面' }));
    expect(screen.getByRole('link', { name: '交換履歴を確認' })).toHaveAttribute('href', '/exchange-history');
  });

  it('allows editing own comment', async () => {
    const user = userEvent.setup();
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
    await user.click(editButtons[0]);

    await user.clear(screen.getByRole('textbox', { name: 'コメント編集' }));
    await user.type(screen.getByRole('textbox', { name: 'コメント編集' }), 'updated comment');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '保存' })).not.toBeDisabled();
    });
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(screen.getByText('コメントを更新しました')).toBeInTheDocument();
    });
    expect(screen.getByText('updated comment')).toBeInTheDocument();
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

    await userEvent.click(screen.getByRole('button', { name: '定型文を挿入' }));
    await userEvent.click(screen.getByRole('button', { name: '定型文1' }));

    expect((screen.getByLabelText('新規コメント') as HTMLTextAreaElement).value.length).toBeGreaterThan(0);
  });

  it('allows deleting own comment', async () => {
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

    expect(screen.queryByRole('button', { name: '削除' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'コメント操作' }));
    await userEvent.click(screen.getByRole('button', { name: '削除' }));
    expect(screen.getByRole('dialog', { name: 'コメントの削除' })).toHaveTextContent('削除対象コメント');
    await userEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => {
      expect(screen.getByText('コメントを削除しました')).toBeInTheDocument();
    });
    expect(screen.getByText('（削除済み）')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '編集' })).not.toBeInTheDocument();
  });

  it('shows package context for pending counter-offer quantities and diffs', async () => {
    const commentsState: ProposalCommentMock[] = [];
    createProposalDetailFetch(commentsState, {
      status: 'confirmed',
      items: [{
        id: 501,
        fromPharmacyId: 1,
        toPharmacyId: 2,
        quantity: 200,
        yakkaValue: 10000,
        drugName: 'テスト薬A',
        unit: '錠',
        packageLabel: 'PTP 100錠',
        packageQuantity: 100,
        packageUnit: '錠',
        yakkaUnitPrice: 50,
      }],
      counterOffers: [{
        id: 9,
        proposerPharmacyId: 2,
        responderPharmacyId: 1,
        status: 'pending',
        summary: '数量を調整したいです',
        items: [{ proposalItemId: 501, drugName: 'テスト薬A', quantity: 100 }],
        responseNote: null,
        createdAt: '2026-03-02T00:00:00.000Z',
        respondedAt: null,
      }],
    });

    renderWithProviders(
      <Routes>
        <Route path="/proposals/:id" element={<ProposalDetailPage />} />
      </Routes>,
      { route: '/proposals/1' },
    );

    await waitFor(() => {
      expect(screen.getByText('相手薬局から正式な反対提案が届いています。')).toBeInTheDocument();
    });

    expect(screen.getByText(/提案項目: テスト薬A 総数量 100錠/)).toBeInTheDocument();
    expect(screen.getAllByText(/箱数 1箱/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1箱入数 100錠/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/包装 PTP 100錠/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/総数量 200錠/).length).toBeGreaterThan(0);
  });

  it('requires confirmation before accepting a pending counter-offer', async () => {
    const user = userEvent.setup();
    const commentsState: ProposalCommentMock[] = [];
    const fetchMock = createProposalDetailFetch(commentsState, {
      status: 'confirmed',
      items: [{
        id: 501,
        fromPharmacyId: 1,
        toPharmacyId: 2,
        quantity: 200,
        yakkaValue: 10000,
        drugName: 'テスト薬A',
        unit: '錠',
        packageLabel: 'PTP 100錠',
        packageQuantity: 100,
        packageUnit: '錠',
        yakkaUnitPrice: 50,
      }],
      counterOffers: [{
        id: 9,
        proposerPharmacyId: 2,
        responderPharmacyId: 1,
        status: 'pending',
        summary: '数量を調整したいです',
        items: [{ proposalItemId: 501, drugName: 'テスト薬A', quantity: 100 }],
        responseNote: null,
        createdAt: '2026-03-02T00:00:00.000Z',
        respondedAt: null,
      }],
    });

    renderWithProviders(
      <Routes>
        <Route path="/proposals/:id" element={<ProposalDetailPage />} />
      </Routes>,
      { route: '/proposals/1' },
    );

    await waitFor(() => {
      expect(screen.getByText('相手薬局から正式な反対提案が届いています。')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: '反対提案を承認' }));

    expect(screen.getByRole('dialog', { name: '反対提案の承認' })).toHaveTextContent('テスト薬A');
    expect(fetchMock.mock.calls.some(([input, init]) => {
      const url = typeof input === 'string' ? input : input.toString();
      return url.includes('/counter-offers/9/respond') && init?.method === 'POST';
    })).toBe(false);

    await user.click(screen.getByRole('button', { name: '反対提案を承認する' }));

    await waitFor(() => {
      const respondCall = fetchMock.mock.calls.find(([input, init]) => {
        const url = typeof input === 'string' ? input : input.toString();
        return url.includes('/counter-offers/9/respond') && init?.method === 'POST';
      });
      expect(respondCall).toBeTruthy();
      expect(JSON.parse(String((respondCall?.[1] as RequestInit | undefined)?.body))).toEqual({
        decision: 'accepted',
      });
    });
  });
});

describe('ProposalDetailPage timeline', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setMatchMedia(false);
  });

  it('uses the mobile accordion and sticky footer composer layout on small screens', async () => {
    const commentsState: ProposalCommentMock[] = [];
    setMatchMedia(true);
    createProposalDetailFetch(commentsState, {
      status: 'confirmed',
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
      ],
    });

    renderWithProviders(
      <Routes>
        <Route path="/proposals/:id" element={<ProposalDetailPage />} />
      </Routes>,
      { route: '/proposals/1' },
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '進行履歴' })).toBeInTheDocument();
    });

    const accordionButton = screen.getByRole('button', { name: '進行履歴' });
    expect(accordionButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('proposal-mobile-comment-composer')).toBeInTheDocument();
    expect(screen.getByTestId('proposal-mobile-sticky-actions')).toBeInTheDocument();

    await userEvent.click(accordionButton);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '進行履歴' })).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('仮マッチング作成')).toBeInTheDocument();
    });
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
