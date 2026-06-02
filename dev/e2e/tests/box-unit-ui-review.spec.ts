import { mkdirSync } from 'node:fs';
import { test, expect, type BrowserContext, type Page, type Route } from '@playwright/test';

const SCREENSHOT_DIR = 'artifacts/playwright-audit/screenshots';

type ApiRecord = Record<string, unknown>;

interface ReviewState {
  deadStockItems: ApiRecord[];
  browseItems: ApiRecord[];
  proposalStatus: string;
  comments: ApiRecord[];
  counterOffers: ApiRecord[];
  templates: ApiRecord[];
  lastProposalCandidate: ApiRecord | null;
}

const currentUser = {
  id: 1001,
  email: 'box-unit-review@example.com',
  name: '箱単位レビュー薬局',
  prefecture: '東京都',
  isAdmin: false,
};

const openBusinessStatus = {
  isOpen: true,
  closingSoon: false,
  is24Hours: false,
  todayHours: { openTime: '09:00', closeTime: '18:00' },
  isConfigured: true,
};

const now = '2026-05-31T09:00:00.000Z';

const candidate = {
  pharmacyId: 1002,
  pharmacyName: 'E2E テスト薬局B',
  distance: 12.3,
  pharmacyPhone: '03-0000-0001',
  pharmacyFax: '03-0000-0002',
  totalValueA: 10000,
  totalValueB: 10000,
  valueDifference: 0,
  score: 92.4,
  matchRate: 98,
  matchType: 'exact',
  businessStatus: openBusinessStatus,
  scoreBreakdown: {
    valueScore: 20,
    balanceScore: 20,
    distanceScore: 18,
    expiryScore: 14,
    diversityScore: 8,
    favoriteBonus: 0,
    groupBonus: 0,
    successRateBonus: 12.4,
    total: 92.4,
  },
  priorityBreakdown: {
    mutualStagnantItems: 2,
    mutualNearExpiryItems: 1,
    mutualExchangeValue: 20000,
    mutualItemCount: 2,
    mutualTraceableItems: 2,
  },
  businessImpact: {
    estimatedWasteAvoidanceYen: 20000,
    estimatedWorkingCapitalReleaseYen: 20000,
    estimatedMutualLiquidationItems: 2,
    estimatedMutualNearExpiryItems: 1,
    estimatedTraceableExchangeItems: 2,
  },
  priorityReasons: [
    { code: 'mutual_exchange_value', label: '相互交換額', value: 20000 },
  ],
  itemsFromA: [
    {
      deadStockItemId: 11,
      drugCode: 'E2E-A',
      drugName: 'テスト薬A 100錠PTP',
      drugMasterPackageId: 101,
      quantity: 100,
      unit: '錠',
      packageLabel: '100錠PTP',
      packageQuantity: 100,
      packageUnit: '錠',
      boxCount: 1,
      yakkaUnitPrice: 100,
      yakkaValue: 10000,
      expirationDate: '2026-06-30',
      expirationDateIso: '2026-06-30',
      lotNumber: 'LOT-A',
      matchScore: 0.99,
    },
  ],
  itemsFromB: [
    {
      deadStockItemId: 22,
      drugCode: 'E2E-B',
      drugName: 'テスト薬B 100錠PTP',
      drugMasterPackageId: 202,
      quantity: 100,
      unit: '錠',
      packageLabel: '100錠PTP',
      packageQuantity: 100,
      packageUnit: '錠',
      boxCount: 1,
      yakkaUnitPrice: 100,
      yakkaValue: 10000,
      expirationDate: '2026-07-31',
      expirationDateIso: '2026-07-31',
      lotNumber: 'LOT-B',
      matchScore: 0.98,
    },
  ],
};

function initialState(): ReviewState {
  return {
    deadStockItems: [
      {
        id: 1,
        drugName: 'テスト薬A 100錠PTP',
        drugCode: 'E2E-A',
        quantity: 250,
        unit: '錠',
        packageLabel: '100錠PTP',
        packageQuantity: 100,
        packageUnit: '錠',
        packageForm: 'ptp',
        isLoosePackage: false,
        yakkaUnitPrice: 100,
        yakkaTotal: 25000,
        expirationDate: '2026-06-30',
        lotNumber: 'LOT-A',
        isAvailable: true,
      },
      {
        id: 2,
        drugName: 'テスト薬C 100錠バラ',
        drugCode: 'E2E-C',
        quantity: 100,
        unit: '錠',
        packageLabel: '100錠バラ',
        packageQuantity: 100,
        packageUnit: '錠',
        packageForm: 'loose',
        isLoosePackage: true,
        yakkaUnitPrice: 50,
        yakkaTotal: 5000,
        expirationDate: '2026-08-31',
        lotNumber: 'LOT-C',
        isAvailable: true,
      },
    ],
    browseItems: [
      {
        id: 10,
        drugName: 'テスト薬A 100錠PTP',
        quantity: 250,
        unit: '錠',
        packageLabel: '100錠PTP',
        packageQuantity: 100,
        packageUnit: '錠',
        packageForm: 'ptp',
        isLoosePackage: false,
        yakkaUnitPrice: 100,
        yakkaTotal: 25000,
        expirationDate: '2026-06-30',
        pharmacyName: 'E2E テスト薬局A',
        prefecture: '東京都',
        businessStatus: openBusinessStatus,
      },
      {
        id: 20,
        drugName: 'テスト薬C 100錠バラ',
        quantity: 100,
        unit: '錠',
        packageLabel: '100錠バラ',
        packageQuantity: 100,
        packageUnit: '錠',
        packageForm: 'loose',
        isLoosePackage: true,
        yakkaUnitPrice: 50,
        yakkaTotal: 5000,
        expirationDate: '2026-08-31',
        pharmacyName: 'E2E テスト薬局B',
        prefecture: '東京都',
        businessStatus: openBusinessStatus,
      },
    ],
    proposalStatus: 'proposed',
    comments: [
      {
        id: 1,
        authorPharmacyId: currentUser.id,
        authorName: currentUser.name,
        body: '初回コメント',
        isDeleted: false,
        createdAt: now,
        updatedAt: now,
      },
    ],
    counterOffers: [],
    templates: [],
    lastProposalCandidate: null,
  };
}

function json(route: Route, payload: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });
}

function empty(route: Route) {
  return route.fulfill({ status: 204, body: '' });
}

function apiPath(route: Route): string {
  const url = new URL(route.request().url());
  return url.pathname.replace(/^\/api/, '');
}

function postData(route: Route): ApiRecord {
  const raw = route.request().postData();
  if (!raw) return {};
  return JSON.parse(raw) as ApiRecord;
}

function buildProposalDetail(state: ReviewState, id = 3001) {
  const proposal = {
    id,
    pharmacyAId: currentUser.id,
    pharmacyBId: 1002,
    status: state.proposalStatus,
    totalValueA: 10000,
    totalValueB: 10000,
    valueDifference: 0,
    proposedAt: now,
    expiresAt: '2026-06-07T09:00:00.000Z',
    expiryReminderSentAt: null,
  };
  const pharmacyA = {
    id: currentUser.id,
    name: '箱単位レビュー薬局',
    phone: '03-1111-1111',
    fax: '03-1111-1112',
    address: '千代田1-1-1',
    prefecture: '東京都',
    licenseNumber: 'LIC-A',
  };
  const pharmacyB = {
    id: 1002,
    name: 'E2E テスト薬局B',
    phone: '03-2222-2221',
    fax: '03-2222-2222',
    address: '中央2-2-2',
    prefecture: '東京都',
    licenseNumber: 'LIC-B',
  };
  const items = [
    {
      id: 501,
      fromPharmacyId: currentUser.id,
      toPharmacyId: 1002,
      quantity: 100,
      unit: '錠',
      packageLabel: '100錠PTP',
      packageQuantity: 100,
      packageUnit: '錠',
      yakkaUnitPrice: 100,
      yakkaValue: 10000,
      drugName: 'テスト薬A 100錠PTP',
    },
    {
      id: 502,
      fromPharmacyId: 1002,
      toPharmacyId: currentUser.id,
      quantity: 100,
      unit: '錠',
      packageLabel: '100錠PTP',
      packageQuantity: 100,
      packageUnit: '錠',
      yakkaUnitPrice: 100,
      yakkaValue: 10000,
      drugName: 'テスト薬B 100錠PTP',
    },
  ];
  return {
    proposal,
    pharmacyA,
    pharmacyB,
    items,
    enrichedTimeline: [
      {
        id: 'timeline-1',
        eventType: 'status_change',
        action: 'proposed',
        label: '仮マッチング開始',
        at: now,
        actorPharmacyId: currentUser.id,
        actorName: currentUser.name,
        priority: 'medium',
      },
    ],
    counterOffers: state.counterOffers,
  };
}

function responseForProposalTemplates(state: ReviewState, route: Route) {
  const path = apiPath(route);
  const method = route.request().method();
  if (method === 'GET' && path === '/proposal-templates') {
    return json(route, state.templates);
  }
  if (method === 'POST' && path === '/proposal-templates') {
    const created = {
      id: 901,
      pharmacyId: currentUser.id,
      name: String(postData(route).name || '保存済みテンプレート'),
      targetPharmacyId: 1002,
      items: [
        { drugName: 'テスト薬A 100錠PTP', quantity: 100 },
        { drugName: 'テスト薬B 100錠PTP', quantity: 100 },
      ],
      createdFromProposalId: 3001,
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    state.templates = [created];
    return json(route, created);
  }
  const deleteMatch = path.match(/^\/proposal-templates\/(\d+)$/);
  if (method === 'DELETE' && deleteMatch) {
    const templateId = Number(deleteMatch[1]);
    state.templates = state.templates.filter((template) => Number(template.id) !== templateId);
    return empty(route);
  }
  const useMatch = path.match(/^\/proposal-templates\/(\d+)\/use$/);
  if (method === 'POST' && useMatch) {
    const templateId = Number(useMatch[1]);
    const updated = state.templates.find((template) => Number(template.id) === templateId) ?? {
      id: templateId,
      pharmacyId: currentUser.id,
      name: '保存済みテンプレート',
      targetPharmacyId: 1002,
      items: [],
      createdFromProposalId: null,
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    const next = { ...updated, usageCount: Number(updated.usageCount ?? 0) + 1 };
    state.templates = state.templates.map((template) => (Number(template.id) === templateId ? next : template));
    return json(route, next);
  }
  return null;
}

async function installApiMocks(context: BrowserContext): Promise<ReviewState> {
  const state = initialState();
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem('swipe-coaching-1001-matching-swipe', '1');
      window.localStorage.setItem('installPromptSnoozed', String(Date.now()));
    } catch {
      // Ignore unavailable storage in hardened browser modes.
    }
    const hideDevtools = () => {
      const style = document.createElement('style');
      style.textContent = [
        '[aria-label="Open Tanstack query devtools"]',
        '.tsqd-parent-container',
        '.tsqd-open-btn-container',
      ].join(',') + '{display:none!important;pointer-events:none!important;}';
      document.head.appendChild(style);
    };
    if (document.head) {
      hideDevtools();
    } else {
      window.addEventListener('DOMContentLoaded', hideDevtools, { once: true });
    }

    class MockEventSource {
      url: string;
      withCredentials: boolean;
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;

      constructor(url: string, init?: EventSourceInit) {
        this.url = url;
        this.withCredentials = Boolean(init?.withCredentials);
        setTimeout(() => this.onopen?.(), 0);
      }

      addEventListener() {}
      close() {}
    }
    Object.defineProperty(window, 'EventSource', { value: MockEventSource });
    Object.defineProperty(window, 'print', {
      value: () => {
        (window as Window & { __boxUnitPrinted?: boolean }).__boxUnitPrinted = true;
      },
    });
    Object.defineProperty(window, 'close', {
      value: () => {
        (window as Window & { __boxUnitClosed?: boolean }).__boxUnitClosed = true;
      },
    });
  });

  await context.route('**/api/**', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (!requestUrl.pathname.startsWith('/api/')) {
      return route.continue();
    }
    const path = apiPath(route);
    const method = route.request().method();
    const url = requestUrl;

    const templateResponse = responseForProposalTemplates(state, route);
    if (templateResponse) return templateResponse;

    if (method === 'GET' && path === '/auth/me') return json(route, currentUser);
    if (method === 'GET' && path === '/auth/csrf-token') return json(route, { csrfToken: 'box-unit-csrf' });
    if (method === 'GET' && path === '/upload/status') {
      return json(route, { deadStockUploaded: true, usedMedicationUploaded: true });
    }
    if (method === 'GET' && path === '/groups/membership-summary') {
      return json(route, { groups: [], groupPharmacyIds: [] });
    }
    if (method === 'GET' && path === '/timeline/bootstrap') {
      return json(route, {
        timeline: { events: [], total: 0, hasMore: false, nextCursor: null },
        digest: { events: [] },
        unreadCount: 0,
      });
    }
    if (method === 'GET' && path === '/timeline/unread-count') return json(route, { unreadCount: 0 });
    if (method === 'GET' && path === '/messages/unread-count') return json(route, { unreadCount: 0 });
    if (method === 'GET' && path === '/messages/threads') return json(route, { data: [] });
    if (method === 'GET' && path.startsWith('/messages/thread/')) {
      return json(route, { data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    }
    if (method === 'POST' && path === '/messages') {
      return json(route, { message: '送信しました', data: { id: 1, createdAt: now } });
    }
    if (method === 'PATCH' && path.startsWith('/messages/thread/')) return json(route, { markedCount: 0 });
    if (method === 'GET' && path === '/notifications') return json(route, { notices: [] });
    if (method === 'GET' && path === '/search/drugs') {
      return json(route, [
        {
          id: 1,
          drugName: 'テスト薬A 100錠PTP',
          genericName: 'テスト薬A',
          specification: '100錠PTP',
          yakkaPrice: '100',
          unit: '錠',
        },
      ]);
    }
    if (method === 'GET' && path === '/match-bookmarks') {
      return json(route, { items: [], page: 1, limit: 100 });
    }
    if (method === 'POST' && path === '/match-bookmarks') {
      return json(route, {
        id: 8001,
        pharmacyId: currentUser.id,
        candidatePharmacyId: 1002,
        candidatePharmacyName: 'E2E テスト薬局B',
        drugCode: String(postData(route).drugCode || 'E2E-A'),
        memo: null,
        createdAt: now,
      });
    }
    if (method === 'DELETE' && path.startsWith('/match-bookmarks/')) return json(route, { ok: true });
    if (method === 'GET' && path === '/match-bookmarks/dismiss-feedback') {
      return json(route, { stats: { distance: 0, expiry: 0, value_gap: 0, item_fit: 0, other: 0 } });
    }
    if (method === 'POST' && path === '/match-bookmarks/dismiss-feedback') {
      return json(route, { stats: { distance: 1, expiry: 0, value_gap: 0, item_fit: 0, other: 0 } });
    }
    if (method === 'GET' && path === '/inventory/dead-stock') {
      return json(route, {
        data: state.deadStockItems,
        pagination: { page: Number(url.searchParams.get('page') ?? 1), totalPages: 1, total: state.deadStockItems.length },
      });
    }
    if (method === 'DELETE' && path.startsWith('/inventory/dead-stock/')) {
      const id = Number(path.split('/').at(-1));
      state.deadStockItems = state.deadStockItems.filter((item) => Number(item.id) !== id);
      return empty(route);
    }
    if (method === 'GET' && path === '/inventory/browse') {
      return json(route, {
        data: state.browseItems,
        pagination: { page: Number(url.searchParams.get('page') ?? 1), totalPages: 1, total: state.browseItems.length },
      });
    }
    if (method === 'POST' && path === '/exchange/find') {
      return json(route, { candidates: [candidate] });
    }
    if (method === 'GET' && path === '/exchange/proposals') {
      return json(route, { data: [], pagination: { page: 1, totalPages: 1, total: 0 } });
    }
    if (method === 'POST' && path === '/exchange/proposals') {
      const body = postData(route);
      state.lastProposalCandidate = body.candidate as ApiRecord;
      return json(route, { proposalId: 3001, message: '仮マッチングを開始しました' });
    }
    if (method === 'GET' && path.match(/^\/exchange\/proposals\/\d+$/)) {
      return json(route, buildProposalDetail(state, Number(path.split('/').at(-1))));
    }
    if (method === 'GET' && path.match(/^\/exchange\/proposals\/\d+\/print$/)) {
      return json(route, buildProposalDetail(state, Number(path.split('/').at(-2))));
    }
    if (method === 'GET' && path.match(/^\/exchange\/proposals\/\d+\/comments$/)) {
      return json(route, { data: state.comments });
    }
    if (method === 'POST' && path.match(/^\/exchange\/proposals\/\d+\/comments$/)) {
      const created = {
        id: state.comments.length + 1,
        authorPharmacyId: currentUser.id,
        authorName: currentUser.name,
        body: String(postData(route).body || ''),
        isDeleted: false,
        createdAt: now,
        updatedAt: now,
      };
      state.comments = [...state.comments, created];
      return json(route, { data: created });
    }
    const commentMatch = path.match(/^\/exchange\/proposals\/\d+\/comments\/(\d+)$/);
    if (method === 'PATCH' && commentMatch) {
      const commentId = Number(commentMatch[1]);
      state.comments = state.comments.map((comment) => (
        Number(comment.id) === commentId
          ? { ...comment, body: String(postData(route).body || ''), updatedAt: '2026-05-31T09:10:00.000Z' }
          : comment
      ));
      return json(route, { ok: true });
    }
    if (method === 'DELETE' && commentMatch) {
      const commentId = Number(commentMatch[1]);
      state.comments = state.comments.filter((comment) => Number(comment.id) !== commentId);
      return empty(route);
    }
    const proposalAction = path.match(/^\/exchange\/proposals\/\d+\/(accept|reject|complete)$/);
    if (method === 'POST' && proposalAction) {
      const action = proposalAction[1];
      if (action === 'accept') {
        state.proposalStatus = state.proposalStatus === 'accepted_b' ? 'confirmed' : 'accepted_a';
        return json(route, { message: '承認しました' });
      }
      if (action === 'reject') {
        state.proposalStatus = 'rejected';
        return json(route, { message: '拒否しました' });
      }
      state.proposalStatus = 'completed';
      return json(route, { message: '交換完了にしました' });
    }
    if (method === 'POST' && path.match(/^\/exchange\/proposals\/\d+\/counter-offers$/)) {
      const body = postData(route);
      state.counterOffers = [
        {
          id: 701,
          proposerPharmacyId: currentUser.id,
          responderPharmacyId: 1002,
          status: 'pending',
          summary: String(body.summary || '正式な反対提案'),
          items: Array.isArray(body.items) ? body.items : [],
          responseNote: null,
          createdAt: now,
          respondedAt: null,
        },
      ];
      return json(route, { ok: true });
    }
    if (method === 'POST' && path.match(/^\/exchange\/proposals\/\d+\/counter-offers\/\d+\/respond$/)) {
      state.counterOffers = state.counterOffers.map((offer) => ({
        ...offer,
        status: postData(route).decision === 'accepted' ? 'accepted' : 'rejected',
        respondedAt: now,
      }));
      return json(route, { ok: true });
    }
    if (method === 'POST' && path.match(/^\/exchange\/proposals\/\d+\/feedback$/)) {
      return json(route, { ok: true });
    }
    return json(route, { error: `Unhandled mock ${method} ${path}` }, 404);
  });

  return state;
}

function collectRuntimeErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on('response', (response) => {
    if (response.url().includes('/api/') && response.status() >= 400) {
      errors.push(`api ${response.status()}: ${response.url()}`);
    }
  });
  return errors;
}

async function expectNoRuntimeErrors(errors: string[]) {
  expect(errors, errors.join('\n')).toEqual([]);
}

test.describe('箱単位UI browser review', () => {
  test.use({ serviceWorkers: 'block' });

  test.beforeAll(() => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  test('デッドストック一覧の箱単位表示と主要ボタンが動作する', async ({ page, context }) => {
    const runtimeErrors = collectRuntimeErrors(page);
    await installApiMocks(context);

    await page.goto('/inventory/dead-stock');
    await expect(page.getByRole('heading', { name: /デッドストックリスト/ })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '出品可能箱数' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '1箱入数' })).toBeVisible();
    await expect(page.getByText('テスト薬A 100錠PTP')).toBeVisible();
    await expect(page.getByRole('cell', { name: '2' }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: '100錠' }).first()).toBeVisible();
    await expect(page.getByText('対象外')).toBeVisible();

    await page.getByPlaceholder('薬品名で検索（スペース区切りで絞り込み）...').fill('テスト薬A');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/search=/);

    await page.getByRole('button', { name: '期限切れ' }).click();
    await page.getByRole('button', { name: '30日以内' }).click();
    await page.getByRole('button', { name: '期限順' }).click();
    await page.getByRole('button', { name: '期限順' }).click();

    await page.getByRole('button', { name: '候補検索' }).first().click();
    await expect(page).toHaveURL(/\/matching\?drug=/);
    await page.goBack();
    await expect(page.getByRole('heading', { name: /デッドストックリスト/ })).toBeVisible();

    const reviewRow = page.getByRole('row', { name: /テスト薬A 100錠PTP/ });
    await reviewRow.getByRole('button', { name: 'その他' }).click();
    await page.getByRole('button', { name: '削除', exact: true }).click();
    await expect(page.getByText('デッドストックデータの削除')).toBeVisible();
    await page.getByRole('button', { name: 'キャンセル' }).click();
    await expect(page.getByText('デッドストックデータの削除')).toBeHidden();

    await reviewRow.getByRole('button', { name: 'その他' }).click();
    await page.getByRole('button', { name: '削除', exact: true }).click();
    await page.getByRole('button', { name: '削除する' }).click();
    await expect(page.getByText('削除しました')).toBeVisible();

    await page.screenshot({ path: `${SCREENSHOT_DIR}/box-unit-dead-stock.png`, fullPage: true });
    await expectNoRuntimeErrors(runtimeErrors);
  });

  test('在庫参照の検索・クリア・候補導線が箱単位表示のまま動作する', async ({ page, context }) => {
    const runtimeErrors = collectRuntimeErrors(page);
    await installApiMocks(context);

    await page.goto('/inventory/browse');
    await expect(page.getByRole('heading', { name: '全薬局の在庫参照' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '出品可能箱数' })).toBeVisible();
    await expect(page.getByText('テスト薬A 100錠PTP')).toBeVisible();
    await expect(page.getByText('対象外')).toBeVisible();

    await page.getByPlaceholder('薬品名で検索（ひらがな・カタカナ対応）...').fill('テスト薬A');
    await page.getByRole('button', { name: '検索' }).click();
    await expect(page.getByRole('button', { name: 'クリア' })).toBeVisible();
    await page.getByRole('button', { name: 'クリア' }).click();
    await expect(page.getByRole('button', { name: 'クリア' })).toBeHidden();

    await page.getByPlaceholder('薬品名で検索（ひらがな・カタカナ対応）...').fill('テスト薬A');
    await page.locator('#app-main-content').getByRole('link', { name: '候補を確認' }).click();
    await expect(page).toHaveURL(/\/matching\?drug=/);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/box-unit-inventory-browse.png`, fullPage: true });
    await expectNoRuntimeErrors(runtimeErrors);
  });

  test('マッチング候補の比較・ブックマーク・箱数調整モーダル・提案作成が動作する', async ({ page, context }) => {
    const runtimeErrors = collectRuntimeErrors(page);
    const state = await installApiMocks(context);

    await page.goto('/matching?inventorySearchDrugs=テスト薬A');
    await expect(page.getByRole('heading', { name: 'マッチング' })).toBeVisible();
    await page.getByRole('button', { name: '全候補を表示' }).click();
    await expect(page).toHaveURL(/\/matching$/);

    await page.getByRole('button', { name: 'マッチングを実行' }).click();
    await expect(page.getByRole('button', { name: /E2E テスト薬局B/ })).toBeVisible();
    await page.getByText('絞り込み・並び替え').click({ timeout: 5000 });
    await page.locator('#matching-sort-by').selectOption('expiry');
    await page.locator('#matching-sort-order').selectOption('asc');
    await page.getByRole('button', { name: 'フィルタをリセット' }).click();

    await page.getByRole('button', { name: /E2E テスト薬局B/ }).click();
    await expect(page.getByRole('columnheader', { name: '箱数' }).first()).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '1箱入数' }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: '1' }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: '100錠' }).first()).toBeVisible();

    const candidatePanel = page.locator('#candidate-panel-1002');
    await page.getByRole('button', { name: '期限切迫を優先' }).click();
    await candidatePanel.getByRole('button', { name: 'その他' }).click();
    await page.getByRole('button', { name: '比較に追加' }).click();
    await expect(page.getByRole('button', { name: 'その他' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'この候補で提案' }).click();
    await expect(page.getByText('数量を調整して仮マッチング')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '元箱数' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '調整後箱数' })).toBeVisible();
    await page.getByRole('button', { name: 'キャンセル' }).click();

    await page.getByRole('button', { name: 'その他' }).first().click();
    await page.getByRole('button', { name: '比較をクリア' }).click();
    await candidatePanel.getByRole('button', { name: 'その他' }).click();
    await page.getByRole('button', { name: 'テスト薬A 100錠PTP をブックマーク' }).click();
    await candidatePanel.getByRole('button', { name: 'その他' }).click();
    await expect(page.getByRole('button', { name: 'テスト薬A 100錠PTP をブックマーク解除' })).toBeVisible();

    await candidatePanel.getByRole('link', { name: 'メッセージを確認' }).click();
    await expect(page).toHaveURL(/\/messages/);
    await page.goto('/matching');
    await page.getByRole('button', { name: 'マッチングを実行' }).click();
    await expect(page.getByRole('button', { name: /E2E テスト薬局B/ })).toBeVisible();
    await page.getByRole('button', { name: /E2E テスト薬局B/ }).click();

    await page.getByRole('button', { name: '仮マッチングする' }).click();
    const modal = page.locator('.modal-content').filter({ hasText: '数量を調整して仮マッチング' });
    await expect(modal).toBeVisible();
    await modal.locator('input[type="number"]').first().fill('1');
    await modal.locator('input[type="number"]').nth(1).fill('1');
    await expect(modal.getByText('100錠', { exact: true })).toHaveCount(4);
    await modal.getByRole('button', { name: '仮マッチングを開始' }).click();
    await expect(page.getByText('E2E テスト薬局Bとの仮マッチングを開始しました')).toBeVisible();

    const sentCandidate = state.lastProposalCandidate;
    expect(sentCandidate).not.toBeNull();
    const itemsFromA = sentCandidate?.itemsFromA as Array<{ quantity: number }> | undefined;
    const itemsFromB = sentCandidate?.itemsFromB as Array<{ quantity: number }> | undefined;
    expect(itemsFromA?.[0]?.quantity).toBe(100);
    expect(itemsFromB?.[0]?.quantity).toBe(100);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/box-unit-matching.png`, fullPage: true });
    await expectNoRuntimeErrors(runtimeErrors);
  });

  test('提案詳細・印刷ページのボタンと箱単位表示が動作する', async ({ page, context }) => {
    const runtimeErrors = collectRuntimeErrors(page);
    const state = await installApiMocks(context);
    page.on('dialog', (dialog) => void dialog.accept());

    await page.goto('/proposals/3001');
    await expect(page.getByRole('heading', { name: 'マッチング #3001' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '箱数' }).first()).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '1箱入数' }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: '100錠PTP' }).first()).toBeVisible();

    const reminderPanel = page.locator('.card').filter({ hasText: 'リマインド / 再送' }).first();
    await reminderPanel.getByRole('button', { name: 'その他' }).click();
    await page.getByRole('button', { name: 'FAX送付済みにする' }).click();
    await reminderPanel.getByRole('button', { name: 'その他' }).click();
    await expect(page.getByRole('button', { name: 'FAX送付メモを解除' })).toBeVisible();
    await page.getByRole('button', { name: 'FAX送付メモを解除' }).click();

    const proposalActionRow = page.getByRole('button', { name: '仮マッチングを承認' }).locator('..');
    await proposalActionRow.getByRole('button', { name: 'その他' }).click();
    await page.getByRole('button', { name: '拒否する' }).click();
    await expect(page.getByText('マッチングの拒否')).toBeVisible();
    await page.getByRole('button', { name: 'キャンセル' }).click();

    await page.getByRole('button', { name: '仮マッチングを承認' }).click();
    await expect(page.getByText('マッチングの承認')).toBeVisible();
    await page.getByRole('button', { name: '承認', exact: true }).click();
    await expect(page.getByText('承認しました')).toBeVisible();

    await page.getByRole('button', { name: 'この内容で正式な反対提案' }).click();
    await expect(page.getByText('正式な反対提案を送信しました')).toBeVisible();

    await page.getByRole('link', { name: 'メッセージを開く' }).click();
    await expect(page).toHaveURL(/\/messages\?/);
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'マッチング #3001' })).toBeVisible();

    const adjustmentActions = page.getByRole('link', { name: '再調整メッセージ' }).locator('xpath=ancestor::*[contains(@class, "dl-action-row")][1]');
    await adjustmentActions.getByRole('button', { name: 'その他' }).click();
    await page.getByRole('link', { name: '条件を変えて再検索' }).click();
    await expect(page).toHaveURL(/\/matching\?/);
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'マッチング #3001' })).toBeVisible();

    await page.getByRole('button', { name: '定型文を挿入' }).click();
    await page.getByRole('button', { name: '定型文1' }).click();
    await page.getByRole('button', { name: 'コメントを投稿' }).click();
    await expect(page.getByText('コメントを投稿しました')).toBeVisible();

    await page.getByRole('button', { name: '編集' }).first().click();
    await page.getByLabel('コメント編集').fill('編集済みコメント');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('コメントを更新しました')).toBeVisible();

    await page.getByRole('button', { name: 'コメント操作' }).first().click();
    await page.getByRole('button', { name: '削除' }).first().click();
    await expect(page.getByText('コメントを削除しました')).toBeVisible();

    state.proposalStatus = 'confirmed';
    await page.goto('/proposals/3001');
    await page.getByRole('button', { name: '交換完了' }).click();
    await expect(page.getByText('マッチングの交換完了')).toBeVisible();
    await page.getByRole('button', { name: '交換完了' }).last().click();
    await expect(page.getByText('交換完了にしました')).toBeVisible();

    await page.getByLabel('コメント（任意）').fill('箱単位レビュー完了');
    await page.getByRole('button', { name: '評価を登録' }).click();
    await expect(page.getByText('取引評価を登録しました')).toBeVisible();

    await page.getByPlaceholder('テンプレート名').fill('箱単位テンプレート');
    await page.getByRole('button', { name: 'この提案を保存' }).click();
    await expect(page.getByText('提案テンプレートを保存しました')).toBeVisible();
    const templateCard = page.locator('.border.rounded.p-2').filter({ hasText: '箱単位テンプレート' });
    await expect(templateCard).toBeVisible();
    await Promise.all([
      page.waitForRequest((request) => {
        const url = new URL(request.url());
        return request.method() === 'DELETE' && url.pathname === '/api/proposal-templates/901';
      }),
      templateCard.getByRole('button', { name: 'その他' }).click().then(() => page.getByRole('button', { name: '削除' }).click()),
    ]);
    await expect(templateCard).toHaveCount(0);

    await expect(page.getByRole('link', { name: '印刷用ページを開く' })).toBeVisible();
    await page.goto('/proposals/3001/print');
    const printPage = page;
    const printErrors = collectRuntimeErrors(printPage);
    await expect(printPage.getByRole('heading', { name: '医薬品交換様式（FAX確認用）' })).toBeVisible();
    await expect(printPage.getByRole('columnheader', { name: '箱数' }).first()).toBeVisible();
    await expect(printPage.getByRole('columnheader', { name: '1箱入数' }).first()).toBeVisible();
    await expect(printPage.getByRole('cell', { name: 'テスト薬A 100錠PTP' })).toBeVisible();
    await expect(printPage.getByRole('cell', { name: /^100錠PTP$/ })).toHaveCount(2);
    await printPage.getByRole('button', { name: '印刷' }).click();
    await expect(printPage.evaluate(() => (window as Window & { __boxUnitPrinted?: boolean }).__boxUnitPrinted)).resolves.toBe(true);
    await printPage.getByRole('button', { name: '閉じる' }).click();
    await expect(printPage.evaluate(() => (window as Window & { __boxUnitClosed?: boolean }).__boxUnitClosed)).resolves.toBe(true);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/box-unit-proposal-detail.png`, fullPage: true });
    await printPage.screenshot({ path: `${SCREENSHOT_DIR}/box-unit-proposal-print.png`, fullPage: true });
    await expectNoRuntimeErrors(runtimeErrors);
    await expectNoRuntimeErrors(printErrors);
  });

  test('モバイル表示のフィルタ・並び替えボタンも開閉できる', async ({ page, context }) => {
    const runtimeErrors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await installApiMocks(context);

    await page.goto('/inventory/dead-stock');
    await expect(page.getByText('出品可能箱数').first()).toBeVisible();
    await expect(page.getByText('対象外')).toBeVisible();

    await page.getByRole('button', { name: /フィルタ/ }).click();
    await expect(page.getByRole('dialog', { name: '期限フィルタ' })).toBeVisible();
    await page.getByLabel('30日以内').check();
    await page.getByRole('button', { name: '適用' }).click();
    await expect(page.getByRole('button', { name: /フィルタ/ })).toContainText('1');

    await page.getByRole('button', { name: /並び替え/ }).click();
    await expect(page.getByRole('dialog', { name: '並び替え' })).toBeVisible();
    await page.getByRole('option', { name: '期限日が近い順' }).click();
    await expect(page.getByRole('button', { name: /並び替え/ })).toBeVisible();

    await page.screenshot({ path: `${SCREENSHOT_DIR}/box-unit-mobile-dead-stock.png`, fullPage: true });
    await expectNoRuntimeErrors(runtimeErrors);
  });
});
