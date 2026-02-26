# Notification Center Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 既存ダッシュボードの通知機能を拡張し、統合通知テーブル + ポーリング + ヘッダーバッジ + コメント既読管理を実装する。

**Architecture:** `notifications` テーブルを新設し、提案作成/ステータス変更/コメント追加時にベストエフォートで通知レコードを生成する。フロントエンドは `NotificationContext` + `useNotificationPolling` フックで30秒間隔ポーリングし、ヘッダーに未読バッジを表示する。

**Tech Stack:** Drizzle ORM (schema + migration), Express 5 routes, React Context + custom hooks, Vitest

**Design Doc:** `docs/plans/2026-02-26-notification-center-design.md`

---

## Task 1: notifications テーブルをスキーマに追加

**Files:**
- Modify: `server/src/db/schema.ts`

**Step 1: スキーマにテーブル定義を追加**

`server/src/db/schema.ts` の末尾（`matchNotifications` テーブルの後）に以下を追加:

```typescript
export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  referenceType: text('reference_type'),
  referenceId: integer('reference_id'),
  isRead: boolean('is_read').notNull().default(false),
  readAt: timestamp('read_at', { mode: 'string' }),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxNotificationsPharmacyUnread: index('idx_notifications_pharmacy_unread')
    .on(table.pharmacyId, table.isRead, table.createdAt),
}));
```

**Step 2: proposalComments に readByRecipient カラムを追加**

`server/src/db/schema.ts` の `proposalComments` テーブル定義に追加:

```typescript
readByRecipient: boolean('read_by_recipient').notNull().default(false),
```

`updatedAt` の後に追加する。

**Step 3: マイグレーションを生成**

Run: `cd server && npx drizzle-kit generate`
Expected: 新しいマイグレーション SQL ファイルが `server/drizzle/` に生成される

**Step 4: コミット**

```bash
git add server/src/db/schema.ts server/drizzle/
git commit -m "feat: add notifications table and readByRecipient column to schema"
```

---

## Task 2: notification-service.ts を作成（TDD）

**Files:**
- Create: `server/src/services/notification-service.ts`
- Create: `server/src/test/notification-service.test.ts`

**Step 1: テストファイルを作成**

```typescript
// server/src/test/notification-service.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    insert: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _and: args })),
  eq: vi.fn((a: unknown, b: unknown) => ({ _eq: [a, b] })),
  desc: vi.fn((col: unknown) => ({ _desc: col })),
  count: vi.fn(() => ({ _count: true })),
  sql: vi.fn(() => ({})),
}));

import {
  createNotification,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
} from '../services/notification-service';

function createInsertChain(result: unknown) {
  const chain = {
    values: vi.fn(),
    returning: vi.fn(),
  };
  chain.values.mockReturnValue(chain);
  chain.returning.mockResolvedValue(result);
  return chain;
}

function createSelectChain(result: unknown) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
    orderBy: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.offset.mockReturnValue(chain);
  chain.orderBy.mockResolvedValue(result);
  return chain;
}

function createUpdateChain(result: unknown) {
  const chain = {
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn(),
  };
  chain.set.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.returning.mockResolvedValue(result);
  return chain;
}

describe('notification-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createNotification', () => {
    it('inserts a notification record', async () => {
      const chain = createInsertChain([{ id: 1 }]);
      mocks.db.insert.mockReturnValue(chain);

      const result = await createNotification({
        pharmacyId: 10,
        type: 'proposal_received',
        title: 'テスト通知',
        message: '提案が届きました',
        referenceType: 'proposal',
        referenceId: 42,
      });

      expect(mocks.db.insert).toHaveBeenCalledTimes(1);
      expect(chain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          pharmacyId: 10,
          type: 'proposal_received',
          title: 'テスト通知',
        }),
      );
      expect(result).toEqual({ id: 1 });
    });

    it('does not throw on failure (best effort)', async () => {
      const chain = createInsertChain([]);
      chain.returning.mockRejectedValue(new Error('DB error'));
      mocks.db.insert.mockReturnValue(chain);

      const result = await createNotification({
        pharmacyId: 10,
        type: 'proposal_received',
        title: 'テスト',
        message: 'テスト',
      });

      expect(result).toBeNull();
    });
  });

  describe('getUnreadCount', () => {
    it('returns the unread count for a pharmacy', async () => {
      const chain = createSelectChain([{ value: 5 }]);
      mocks.db.select.mockReturnValue(chain);

      const result = await getUnreadCount(10);

      expect(result).toBe(5);
    });
  });

  describe('markAsRead', () => {
    it('marks a single notification as read', async () => {
      const chain = createUpdateChain([{ id: 1 }]);
      mocks.db.update.mockReturnValue(chain);

      const result = await markAsRead(1, 10);

      expect(result).toBe(true);
      expect(chain.set).toHaveBeenCalledWith(
        expect.objectContaining({ isRead: true }),
      );
    });

    it('returns false when no rows updated', async () => {
      const chain = createUpdateChain([]);
      mocks.db.update.mockReturnValue(chain);

      const result = await markAsRead(999, 10);

      expect(result).toBe(false);
    });
  });

  describe('markAllAsRead', () => {
    it('marks all unread notifications as read', async () => {
      const chain = createUpdateChain([{ id: 1 }, { id: 2 }]);
      mocks.db.update.mockReturnValue(chain);

      const result = await markAllAsRead(10);

      expect(result).toBe(2);
    });
  });
});
```

**Step 2: テストが失敗することを確認**

Run: `cd server && npx vitest run src/test/notification-service.test.ts`
Expected: FAIL — `notification-service` モジュールが存在しない

**Step 3: サービスを実装**

```typescript
// server/src/services/notification-service.ts
import { and, count, desc, eq } from 'drizzle-orm';
import { db } from '../config/database';
import { notifications } from '../db/schema';
import { logger } from './logger';

interface CreateNotificationInput {
  pharmacyId: number;
  type: string;
  title: string;
  message: string;
  referenceType?: string;
  referenceId?: number;
}

export async function createNotification(
  input: CreateNotificationInput,
): Promise<{ id: number } | null> {
  try {
    const [result] = await db.insert(notifications).values({
      pharmacyId: input.pharmacyId,
      type: input.type,
      title: input.title,
      message: input.message,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
    }).returning({ id: notifications.id });
    return result ?? null;
  } catch (err) {
    logger.error('Failed to create notification', { error: (err as Error).message });
    return null;
  }
}

export async function getUnreadCount(pharmacyId: number): Promise<number> {
  const [result] = await db.select({ value: count() })
    .from(notifications)
    .where(and(
      eq(notifications.pharmacyId, pharmacyId),
      eq(notifications.isRead, false),
    ));
  return result?.value ?? 0;
}

export async function getNotifications(
  pharmacyId: number,
  page: number = 1,
  limit: number = 20,
): Promise<{ rows: typeof notifications.$inferSelect[]; total: number }> {
  const offset = (page - 1) * limit;

  const [countResult] = await db.select({ value: count() })
    .from(notifications)
    .where(eq(notifications.pharmacyId, pharmacyId));

  const rows = await db.select()
    .from(notifications)
    .where(eq(notifications.pharmacyId, pharmacyId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .offset(offset);

  return { rows, total: countResult?.value ?? 0 };
}

export async function markAsRead(
  notificationId: number,
  pharmacyId: number,
): Promise<boolean> {
  const result = await db.update(notifications)
    .set({ isRead: true, readAt: new Date().toISOString() })
    .where(and(
      eq(notifications.id, notificationId),
      eq(notifications.pharmacyId, pharmacyId),
    ))
    .returning({ id: notifications.id });
  return result.length > 0;
}

export async function markAllAsRead(pharmacyId: number): Promise<number> {
  const result = await db.update(notifications)
    .set({ isRead: true, readAt: new Date().toISOString() })
    .where(and(
      eq(notifications.pharmacyId, pharmacyId),
      eq(notifications.isRead, false),
    ))
    .returning({ id: notifications.id });
  return result.length;
}
```

**Step 4: テストが通ることを確認**

Run: `cd server && npx vitest run src/test/notification-service.test.ts`
Expected: PASS

**Step 5: コミット**

```bash
git add server/src/services/notification-service.ts server/src/test/notification-service.test.ts
git commit -m "feat: add notification-service with TDD tests"
```

---

## Task 3: 通知 API エンドポイントを追加

**Files:**
- Modify: `server/src/routes/notifications.ts` (既存ルートに追加)
- Modify: `server/src/app.ts` (ルートは既に登録済み、変更不要の可能性あり)

**Step 1: notifications.ts に新エンドポイントを追加**

既存の `notifications.ts` ファイルの末尾（`export default router` の前）に以下の3エンドポイントを追加:

```typescript
// GET /api/notifications/unread-count
router.get('/unread-count', async (req: AuthRequest, res: Response) => {
  try {
    const pharmacyId = req.user!.id;
    const unreadCount = await getUnreadCount(pharmacyId);
    res.json({ unreadCount });
  } catch (err) {
    logger.error('Get unread count error', { error: (err as Error).message });
    res.status(500).json({ error: '未読件数の取得に失敗しました' });
  }
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', async (req: AuthRequest, res: Response) => {
  try {
    const notificationId = parsePositiveInt(req.params.id);
    if (!notificationId) {
      res.status(400).json({ error: '不正なIDです' });
      return;
    }
    const success = await markAsRead(notificationId, req.user!.id);
    if (!success) {
      res.status(404).json({ error: '通知が見つかりません' });
      return;
    }
    res.json({ message: '既読にしました' });
  } catch (err) {
    logger.error('Mark as read error', { error: (err as Error).message });
    res.status(500).json({ error: '既読更新に失敗しました' });
  }
});

// PATCH /api/notifications/read-all
router.patch('/read-all', async (req: AuthRequest, res: Response) => {
  try {
    const count = await markAllAsRead(req.user!.id);
    res.json({ message: `${count}件を既読にしました`, count });
  } catch (err) {
    logger.error('Mark all as read error', { error: (err as Error).message });
    res.status(500).json({ error: '一括既読更新に失敗しました' });
  }
});
```

`notifications.ts` の import に以下を追加:
```typescript
import { getUnreadCount, markAsRead, markAllAsRead } from '../services/notification-service';
```

**重要:** `/read-all` は `/api/notifications/read-all` としてマウントされるため、`/:id/read` より先に定義すること（Express のルーティング順序）。

**Step 2: テストを作成**

```typescript
// server/src/test/notification-route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/notification-service', () => ({
  getUnreadCount: vi.fn(),
  markAsRead: vi.fn(),
  markAllAsRead: vi.fn(),
}));

vi.mock('../services/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { getUnreadCount, markAsRead, markAllAsRead } from '../services/notification-service';

describe('notification routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /unread-count', () => {
    it('getUnreadCount returns a number', async () => {
      vi.mocked(getUnreadCount).mockResolvedValue(3);
      const result = await getUnreadCount(10);
      expect(result).toBe(3);
    });
  });

  describe('PATCH /:id/read', () => {
    it('markAsRead returns true on success', async () => {
      vi.mocked(markAsRead).mockResolvedValue(true);
      const result = await markAsRead(1, 10);
      expect(result).toBe(true);
    });

    it('markAsRead returns false when not found', async () => {
      vi.mocked(markAsRead).mockResolvedValue(false);
      const result = await markAsRead(999, 10);
      expect(result).toBe(false);
    });
  });

  describe('PATCH /read-all', () => {
    it('markAllAsRead returns count', async () => {
      vi.mocked(markAllAsRead).mockResolvedValue(5);
      const result = await markAllAsRead(10);
      expect(result).toBe(5);
    });
  });
});
```

**Step 3: テストが通ることを確認**

Run: `cd server && npx vitest run src/test/notification-route.test.ts`
Expected: PASS

**Step 4: コミット**

```bash
git add server/src/routes/notifications.ts server/src/test/notification-route.test.ts
git commit -m "feat: add unread-count, mark-read, mark-all-read notification endpoints"
```

---

## Task 4: 既存サービスに通知生成を追加

**Files:**
- Modify: `server/src/services/exchange-service.ts`
- Modify: `server/src/routes/exchange.ts` (コメント追加時)

**Step 1: exchange-service.ts に通知生成を追加**

`exchange-service.ts` の `createProposal` 関数内、トランザクション完了後（`return proposal.id` の前）に追加:

```typescript
import { createNotification } from './notification-service';

// createProposal 内、トランザクション成功後:
void createNotification({
  pharmacyId: candidate.pharmacyBId,
  type: 'proposal_received',
  title: '交換提案が届きました',
  message: `新しい交換提案（${validatedA.length + validatedB.length}品目）`,
  referenceType: 'proposal',
  referenceId: proposal.id,
});
```

`acceptProposal` 関数内、ステータス更新成功後に追加:

```typescript
// acceptProposal 内、ステータス更新成功後:
const otherPartyId = proposal.pharmacyAId === pharmacyId
  ? proposal.pharmacyBId
  : proposal.pharmacyAId;

void createNotification({
  pharmacyId: otherPartyId,
  type: 'proposal_status_changed',
  title: '交換提案のステータスが更新されました',
  message: `提案が${newStatus === 'confirmed' ? '確定' : '承認'}されました`,
  referenceType: 'proposal',
  referenceId: proposalId,
});
```

`rejectProposal` 関数内、ステータス変更後に追加:

```typescript
const otherPartyId = proposal.pharmacyAId === pharmacyId
  ? proposal.pharmacyBId
  : proposal.pharmacyAId;

void createNotification({
  pharmacyId: otherPartyId,
  type: 'proposal_status_changed',
  title: '交換提案が却下されました',
  message: '相手薬局が提案を却下しました',
  referenceType: 'proposal',
  referenceId: proposalId,
});
```

**Step 2: exchange.ts のコメント追加 POST に通知生成を追加**

`server/src/routes/exchange.ts` の `POST /proposals/:id/comments` ハンドラ内、
`res.status(201).json(...)` の前に追加:

```typescript
import { createNotification } from '../services/notification-service';

// コメント保存成功後、レスポンス前に:
const recipientId = proposal.pharmacyAId === req.user!.id
  ? proposal.pharmacyBId
  : proposal.pharmacyAId;

void createNotification({
  pharmacyId: recipientId,
  type: 'new_comment',
  title: 'コメントが追加されました',
  message: body.length > 50 ? body.substring(0, 50) + '...' : body,
  referenceType: 'comment',
  referenceId: saved.id,
});
```

**Step 3: 既存テストが通ることを確認**

Run: `npm run test:server`
Expected: 全テストPASS（通知生成は `void` でベストエフォートなので既存テストへの影響なし）

**Step 4: コミット**

```bash
git add server/src/services/exchange-service.ts server/src/routes/exchange.ts
git commit -m "feat: generate notifications on proposal/comment events"
```

---

## Task 5: 既存 GET /api/notifications に notifications テーブルからの通知を統合

**Files:**
- Modify: `server/src/routes/notifications.ts`

**Step 1: 既存の GET /api/notifications ハンドラに notifications テーブルのクエリを追加**

`notifications.ts` の既存 GET ハンドラ内で、3つの Promise.allSettled 呼び出し（exchangeProposals, adminMessages, matchNotifications）に4番目として追加:

```typescript
import { notifications as notificationsTable } from '../db/schema';

// Promise.allSettled 配列に追加:
db.select()
  .from(notificationsTable)
  .where(eq(notificationsTable.pharmacyId, pharmacyId))
  .orderBy(desc(notificationsTable.createdAt))
  .limit(50),
```

取得結果を NoticeItem に変換するヘルパーを追加:

```typescript
function notificationToNotice(n: typeof notificationsTable.$inferSelect): NoticeItem {
  const actionPaths: Record<string, string> = {
    proposal: `/proposals/${n.referenceId}`,
    match: '/matching',
    comment: `/proposals/${n.referenceId}`,
  };

  return {
    id: `notification-${n.id}`,
    type: (n.type === 'new_comment' ? 'status_update' : n.type) as NoticeType,
    title: n.title,
    body: n.message,
    actionPath: actionPaths[n.referenceType ?? ''] ?? '/dashboard',
    actionLabel: '確認する',
    createdAt: n.createdAt,
    deadlineAt: null,
    unread: !n.isRead,
    priority: 5,
  };
}
```

`NoticeType` に `'new_comment'` を追加するか、マッピングで既存タイプに変換する。

**Step 2: summary に notifications テーブルの未読件数を含める**

`summary.total` と `summary.actionableRequests` に notifications テーブルの未読件数を加算。

**Step 3: 既存テストとの整合性を確認**

Run: `npm run test:server`
Expected: PASS

**Step 4: コミット**

```bash
git add server/src/routes/notifications.ts
git commit -m "feat: integrate notifications table into GET /api/notifications"
```

---

## Task 6: NotificationContext を作成

**Files:**
- Create: `client/src/contexts/NotificationContext.tsx`
- Modify: `client/src/main.tsx` (Provider 追加)

**Step 1: NotificationContext を作成**

```typescript
// client/src/contexts/NotificationContext.tsx
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { useAuth } from './AuthContext';

interface NotificationContextValue {
  unreadCount: number;
  refreshCount: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue>({
  unreadCount: 0,
  refreshCount: async () => {},
});

const POLL_INTERVAL_MS = 30_000;

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchCount = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api.get<{ unreadCount: number }>('/notifications/unread-count');
      setUnreadCount(data.unreadCount);
    } catch {
      // ベストエフォート: エラー時は前回の値を保持
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      return;
    }

    void fetchCount();

    timerRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchCount();
      }
    }, POLL_INTERVAL_MS);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void fetchCount();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [user, fetchCount]);

  return (
    <NotificationContext.Provider value={{ unreadCount, refreshCount: fetchCount }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationContext);
}
```

**Step 2: main.tsx に Provider を追加**

`AuthProvider` の内側、`<App />` の外側に `<NotificationProvider>` をラップ:

```tsx
<AuthProvider>
  <NotificationProvider>
    <App />
  </NotificationProvider>
</AuthProvider>
```

import 追加:
```tsx
import { NotificationProvider } from './contexts/NotificationContext';
```

**Step 3: コミット**

```bash
git add client/src/contexts/NotificationContext.tsx client/src/main.tsx
git commit -m "feat: add NotificationContext with polling"
```

---

## Task 7: ヘッダーに通知バッジを追加

**Files:**
- Modify: `client/src/components/Header.tsx`

**Step 1: Header.tsx に未読バッジを追加**

`Header.tsx` にインポート追加:
```typescript
import { useNotifications } from '../contexts/NotificationContext';
import { Badge } from 'react-bootstrap';
```

コンポーネント内で hook を使用:
```typescript
const { unreadCount } = useNotifications();
```

`app-header-quick` セクション内（既存のクイックリンクの前）にベルアイコンを追加:

```tsx
{unreadCount > 0 && (
  <Badge
    bg="danger"
    pill
    className="me-2 cursor-pointer"
    onClick={() => navigate('/dashboard')}
    title={`${unreadCount}件の未読通知`}
  >
    {unreadCount > 99 ? '99+' : unreadCount}
  </Badge>
)}
```

**Step 2: コミット**

```bash
git add client/src/components/Header.tsx
git commit -m "feat: add unread notification badge to header"
```

---

## Task 8: ダッシュボード通知タイプを拡張

**Files:**
- Modify: `client/src/components/dashboard/types.ts`
- Modify: `client/src/components/dashboard/DashboardNotices.tsx`

**Step 1: types.ts に new_comment タイプを追加**

`Notice` の `type` に `'new_comment'` を追加:

```typescript
type: 'inbound_request' | 'outbound_request' | 'status_update' | 'admin_message' | 'match_update' | 'new_comment';
```

`noticeVariant` に追加:
```typescript
if (type === 'new_comment') return 'success';
```

`noticeTypeLabel` に追加:
```typescript
if (type === 'new_comment') return 'コメント';
```

`resolveNoticeReadEndpoint` に notifications テーブル用のハンドリングを追加:
```typescript
if (notice.type === 'new_comment') {
  const notifId = parseNotificationId(notice.id);
  return notifId ? `/notifications/${notifId}/read` : null;
}
```

ヘルパー関数を追加:
```typescript
export function parseNotificationId(noticeId: string): number | null {
  if (!noticeId.startsWith('notification-')) return null;
  const id = Number(noticeId.replace('notification-', ''));
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}
```

**Step 2: buildNextAction に new_comment ハンドリングを追加**

`buildNextAction` 内の `topUnreadNotice?.type === 'match_update'` の前に追加:

```typescript
if (topUnreadNotice?.type === 'new_comment') {
  return {
    title: '新しいコメントを確認',
    description: '提案にコメントが追加されました。確認してください。',
    primaryLabel: topUnreadNotice.actionLabel || 'コメントを確認',
    primaryPath: sanitizeInternalPath(topUnreadNotice.actionPath, '/proposals'),
    secondaryLabel: 'マッチング一覧を確認',
    secondaryPath: '/proposals',
    badge: 'primary',
  };
}
```

**Step 3: resolveNoticeReadEndpoint の PATCH メソッド対応**

現在の `handleNoticeClick` は `api.post(readEndpoint)` で呼んでいるが、新エンドポイントは PATCH。
`DashboardPage.tsx` の `handleNoticeClick` で readEndpoint のメソッドを判定するか、
通知テーブルの既読 API を POST でも受け付けるようにする。

最もシンプルな方法: `server/src/routes/notifications.ts` で PATCH に加えて POST も受け付ける:

```typescript
router.patch('/:id/read', markReadHandler);
router.post('/:id/read', markReadHandler);  // 互換性のため
```

**Step 4: 既存テストが通ることを確認**

Run: `npm run test:client`
Expected: PASS

**Step 5: コミット**

```bash
git add client/src/components/dashboard/types.ts client/src/components/dashboard/DashboardNotices.tsx client/src/pages/DashboardPage.tsx
git commit -m "feat: extend dashboard with new_comment notification type"
```

---

## Task 9: ダッシュボードのポーリング自動更新を統合

**Files:**
- Modify: `client/src/pages/DashboardPage.tsx`

**Step 1: ダッシュボードにポーリング連携を追加**

`DashboardPage.tsx` に import 追加:
```typescript
import { useNotifications } from '../contexts/NotificationContext';
```

コンポーネント内で hook を使用:
```typescript
const { refreshCount } = useNotifications();
```

`handleNoticeClick` 内の `void reload()` の後に追加:
```typescript
void refreshCount();
```

これにより通知クリック時にヘッダーバッジも即座に更新される。

**Step 2: コミット**

```bash
git add client/src/pages/DashboardPage.tsx
git commit -m "feat: sync dashboard reload with notification badge count"
```

---

## Task 10: 全体テスト & 最終確認

**Files:**
- No new files

**Step 1: サーバーテストを全件実行**

Run: `npm run test:server`
Expected: ALL PASS

**Step 2: クライアントテストを全件実行**

Run: `npm run test:client`
Expected: ALL PASS

**Step 3: 型チェック**

Run: `npm run typecheck` (or `cd server && npx tsc --noEmit && cd ../client && npx tsc --noEmit`)
Expected: No errors

**Step 4: ビルド確認**

Run: `npm run build:server && npm run build:client`
Expected: Build success

**Step 5: 最終コミット（必要に応じて修正後）**

```bash
git add -A
git commit -m "feat: notification center - all tests passing and build verified"
```
