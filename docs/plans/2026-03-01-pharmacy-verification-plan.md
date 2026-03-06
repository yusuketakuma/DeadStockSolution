# 薬局アカウント自動認証 実装計画

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** OpenClawを介して厚生局の薬局機能情報提供制度APIで薬局を検証し、事前審査制のアカウント開設フローを構築する。

**Architecture:** 登録時に仮アカウント（`verificationStatus: 'pending_verification'`）を作成し、`user_requests` 経由でOpenClawに検証依頼を投入。OpenClawがコールバックで結果を返し、承認/却下を反映する非同期審査フロー。

**Tech Stack:** Express 5, Drizzle ORM, Vitest, React 18, React Bootstrap

---

## Task 1: pharmacies テーブルにカラム追加

**Files:**
- Modify: `server/src/db/schema.ts:53-77`

**Step 1: スキーマにカラムを追加**

`server/src/db/schema.ts` の `pharmacies` テーブル定義（77行目の閉じ括弧の直前）に以下を追加:

```typescript
verificationStatus: text('verification_status').notNull().default('pending_verification'),
verificationRequestId: integer('verification_request_id'),
verifiedAt: timestamp('verified_at', { mode: 'string' }),
rejectionReason: text('rejection_reason'),
```

**Step 2: マイグレーション生成**

Run: `cd server && npx drizzle-kit generate`
Expected: `drizzle/` にマイグレーションファイルが生成される

**Step 3: マイグレーション適用**

Run: `cd server && npx drizzle-kit push`
Expected: 4カラムが pharmacies テーブルに追加。新規レコード既定値は `verification_status = 'pending_verification'`

**Step 4: 既存アカウントを verified に更新するマイグレーション**

`server/drizzle/` にSQL追加（またはpush後に手動実行）:

```sql
UPDATE pharmacies SET verification_status = 'verified' WHERE verification_status = 'unverified';
```

**Step 5: コミット**

```bash
git add server/src/db/schema.ts server/drizzle/
git commit -m "feat: add verification columns to pharmacies table"
```

---

## Task 2: 検証ステータス型定義とヘルパー

**Files:**
- Create: `server/src/services/pharmacy-verification-service.ts`
- Test: `server/src/test/pharmacy-verification-service.test.ts`

**Step 1: テストファイルを作成**

```typescript
// server/src/test/pharmacy-verification-service.test.ts
import { describe, it, expect } from 'vitest';
import {
  type VerificationStatus,
  isVerified,
  isPendingVerification,
  canLogin,
} from '../services/pharmacy-verification-service';

describe('pharmacy-verification-service', () => {
  describe('isVerified', () => {
    it('returns true for verified status', () => {
      expect(isVerified('verified')).toBe(true);
    });
    it('returns false for pending_verification', () => {
      expect(isVerified('pending_verification')).toBe(false);
    });
    it('returns false for rejected', () => {
      expect(isVerified('rejected')).toBe(false);
    });
  });

  describe('isPendingVerification', () => {
    it('returns true for pending_verification', () => {
      expect(isPendingVerification('pending_verification')).toBe(true);
    });
    it('returns false for verified', () => {
      expect(isPendingVerification('verified')).toBe(false);
    });
  });

  describe('canLogin', () => {
    it('returns true for verified + active', () => {
      expect(canLogin('verified', true)).toBe(true);
    });
    it('returns true for pending + active (re-verification)', () => {
      expect(canLogin('pending_verification', true)).toBe(true);
    });
    it('returns false for verified + inactive', () => {
      expect(canLogin('verified', false)).toBe(false);
    });
    it('returns false for pending + inactive', () => {
      expect(canLogin('pending_verification', false)).toBe(false);
    });
  });
});
```

**Step 2: テスト実行して失敗を確認**

Run: `cd server && npx vitest run src/test/pharmacy-verification-service.test.ts`
Expected: FAIL（モジュール未定義）

**Step 3: サービス実装**

```typescript
// server/src/services/pharmacy-verification-service.ts
export type VerificationStatus = 'pending_verification' | 'verified' | 'rejected';

export function isVerified(status: VerificationStatus): boolean {
  return status === 'verified';
}

export function isPendingVerification(status: VerificationStatus): boolean {
  return status === 'pending_verification';
}

export function canLogin(_status: VerificationStatus, isActive: boolean): boolean {
  return isActive;
}
```

**Step 4: テスト実行して成功を確認**

Run: `cd server && npx vitest run src/test/pharmacy-verification-service.test.ts`
Expected: PASS

**Step 5: コミット**

```bash
git add server/src/services/pharmacy-verification-service.ts server/src/test/pharmacy-verification-service.test.ts
git commit -m "feat: add pharmacy verification status helpers"
```

---

## Task 3: 登録APIの変更（事前審査制）

**Files:**
- Modify: `server/src/routes/auth.ts:143-332`
- Test: `server/src/test/auth-route.test.ts`

**Step 1: 登録テストを追加**

既存の `server/src/test/auth-route.test.ts` に以下のテストケースを追加:

```typescript
describe('POST /api/auth/register (verification flow)', () => {
  it('creates account with pending_verification status', async () => {
    // Mock: screening passes
    // Mock: db.insert returns pharmacy with verificationStatus='pending_verification'
    // Mock: user_requests insert succeeds
    const res = await request(app).post('/api/auth/register').send({
      email: 'test@pharmacy.jp',
      password: 'SecureP@ss1',
      name: 'テスト薬局',
      postalCode: '100-0001',
      address: '東京都千代田区1-1-1',
      phone: '03-1234-5678',
      fax: '03-1234-5679',
      licenseNumber: 'A-12345',
      prefecture: '東京都',
      permitLicenseNumber: 'A-12345',
      permitPharmacyName: 'テスト薬局',
      permitAddress: '東京都千代田区1-1-1',
    });
    expect(res.status).toBe(201);
    expect(res.body.verificationStatus).toBe('pending_verification');
    expect(res.body.message).toContain('審査');
  });

  it('returns pending status without JWT token', async () => {
    // 審査中はログイン用トークンを返さない
    const res = await request(app).post('/api/auth/register').send({...});
    expect(res.body.token).toBeUndefined();
  });
});
```

**Step 2: テスト実行して失敗を確認**

Run: `cd server && npx vitest run src/test/auth-route.test.ts`
Expected: FAIL（現在は即時承認でトークンを返す）

**Step 3: auth.ts の登録ハンドラを変更**

`server/src/routes/auth.ts` の `POST /register` ハンドラ（143-332行目）を変更:

主な変更点:
1. スクリーニング通過後、`isActive: false`, `verificationStatus: 'pending_verification'` で pharmacies に挿入
2. `user_requests` に `pharmacy_verification` リクエストを投入
3. JWTトークンは返さず、`{ verificationStatus: 'pending_verification', message: '登録申請を受け付けました。審査完了後にメールでお知らせします。' }` を返す
4. スクリーニング不合格時の処理は従来通り（403で却下理由を返す）

```typescript
// 変更箇所の概要（auth.ts:240-270付近）
// Before: screening.approved → create pharmacy (isActive: true) → return JWT
// After:
if (screening.approved) {
  const [createdPharmacy] = await tx.insert(pharmacies).values({
    email, passwordHash, name, postalCode, address, phone, fax,
    licenseNumber, prefecture, latitude, longitude,
    isActive: false,  // 変更: 審査中はログイン不可
    verificationStatus: 'pending_verification',  // 追加
  }).returning();

  // user_requests に検証リクエスト投入
  const [verificationRequest] = await tx.insert(userRequests).values({
    pharmacyId: createdPharmacy.id,
    requestText: JSON.stringify({
      type: 'pharmacy_verification',
      pharmacyName: name,
      postalCode, prefecture, address, licenseNumber,
      instruction: '薬局機能情報提供制度APIで検索し、薬局名と開設許可番号の一致を確認してください',
    }),
  }).returning();

  // verificationRequestId を更新
  await tx.update(pharmacies)
    .set({ verificationRequestId: verificationRequest.id })
    .where(eq(pharmacies.id, createdPharmacy.id));

  // JWTは返さない
  return {
    approved: true,
    pharmacyId: createdPharmacy.id,
    verificationStatus: 'pending_verification',
    reviewId: review.id,
  };
}
```

レスポンス部分:
```typescript
// Before: res.cookie('token', ...) + res.status(201).json(...)
// After:
res.status(201).json({
  message: '登録申請を受け付けました。審査完了後にメールでお知らせします。',
  verificationStatus: 'pending_verification',
  pharmacyId: result.pharmacyId,
});
```

**Step 4: テスト実行して成功を確認**

Run: `cd server && npx vitest run src/test/auth-route.test.ts`
Expected: PASS

**Step 5: コミット**

```bash
git add server/src/routes/auth.ts server/src/test/auth-route.test.ts
git commit -m "feat: change registration to pending verification flow"
```

---

## Task 4: OpenClawへの自動ハンドオフ

**Files:**
- Modify: `server/src/routes/auth.ts` (登録成功後にhandoffToOpenClawを呼ぶ)
- Test: `server/src/test/auth-route.test.ts`

**Step 1: テスト追加**

```typescript
it('triggers OpenClaw handoff after registration', async () => {
  // Mock handoffToOpenClaw
  const handoffSpy = vi.fn().mockResolvedValue({ accepted: true });
  // ... register successfully ...
  expect(handoffSpy).toHaveBeenCalledWith(expect.objectContaining({
    requestId: expect.any(Number),
    pharmacyId: expect.any(Number),
  }));
});
```

**Step 2: テスト実行して失敗を確認**

Run: `cd server && npx vitest run src/test/auth-route.test.ts`

**Step 3: 登録ハンドラにOpenClawハンドオフを追加**

トランザクション完了後（非同期、レスポンス返却をブロックしない）:

```typescript
// auth.ts: register handler, after transaction commit
// Fire-and-forget: OpenClaw handoff
if (result.approved && result.verificationStatus === 'pending_verification') {
  handoffToOpenClaw({
    requestId: verificationRequest.id,
    pharmacyId: result.pharmacyId,
    requestText: JSON.stringify({
      type: 'pharmacy_verification',
      pharmacyName: name,
      postalCode, prefecture, address, licenseNumber,
    }),
  }).catch((err) => {
    logger.error('OpenClaw verification handoff failed', () => ({
      pharmacyId: result.pharmacyId,
      error: err instanceof Error ? err.message : String(err),
    }));
  });
}
```

**Step 4: テスト実行して成功を確認**

Run: `cd server && npx vitest run src/test/auth-route.test.ts`

**Step 5: コミット**

```bash
git add server/src/routes/auth.ts server/src/test/auth-route.test.ts
git commit -m "feat: trigger OpenClaw handoff on pharmacy registration"
```

---

## Task 5: OpenClaw Webhookで検証結果を処理

**Files:**
- Modify: `server/src/routes/openclaw.ts:44-100`
- Create: `server/src/services/pharmacy-verification-callback-service.ts`
- Test: `server/src/test/pharmacy-verification-callback-service.test.ts`

**Step 1: コールバックサービスのテスト作成**

```typescript
// server/src/test/pharmacy-verification-callback-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([{ id: 1 }]),
  },
}));

vi.mock('../config/database', () => ({ db: mocks.db }));

import { processVerificationCallback } from '../services/pharmacy-verification-callback-service';

describe('processVerificationCallback', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('approves pharmacy on positive verification', async () => {
    const result = await processVerificationCallback({
      pharmacyId: 1,
      requestId: 10,
      approved: true,
      reason: '薬局名・許可番号一致',
    });
    expect(result.verificationStatus).toBe('verified');
    // db.update should set isActive=true, verificationStatus='verified'
  });

  it('rejects pharmacy on negative verification', async () => {
    const result = await processVerificationCallback({
      pharmacyId: 1,
      requestId: 10,
      approved: false,
      reason: '許可番号が見つかりません',
    });
    expect(result.verificationStatus).toBe('rejected');
    // db.update should keep isActive=false, set rejectionReason
  });
});
```

**Step 2: テスト実行して失敗を確認**

Run: `cd server && npx vitest run src/test/pharmacy-verification-callback-service.test.ts`

**Step 3: コールバックサービス実装**

```typescript
// server/src/services/pharmacy-verification-callback-service.ts
import { eq } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies } from '../db/schema';
import { logger } from './logger';
import type { VerificationStatus } from './pharmacy-verification-service';

interface VerificationCallbackInput {
  pharmacyId: number;
  requestId: number;
  approved: boolean;
  reason: string;
}

interface VerificationCallbackResult {
  verificationStatus: VerificationStatus;
  pharmacyId: number;
}

export async function processVerificationCallback(
  input: VerificationCallbackInput,
): Promise<VerificationCallbackResult> {
  const { pharmacyId, approved, reason } = input;
  const now = new Date().toISOString();
  const verificationStatus: VerificationStatus = approved ? 'verified' : 'rejected';

  await db.update(pharmacies)
    .set({
      verificationStatus,
      isActive: approved,
      verifiedAt: approved ? now : null,
      rejectionReason: approved ? null : reason,
      updatedAt: now,
    })
    .where(eq(pharmacies.id, pharmacyId));

  logger.info('Pharmacy verification callback processed', () => ({
    pharmacyId,
    verificationStatus,
    approved,
  }));

  return { verificationStatus, pharmacyId };
}
```

**Step 4: openclaw.ts のWebhookルートに検証コールバック処理を追加**

`server/src/routes/openclaw.ts` の `POST /callback` ハンドラ内で、リクエストの `requestText` をパースし `type` が `pharmacy_verification` または `pharmacy_reverification` の場合に `processVerificationCallback` を呼ぶ:

```typescript
// openclaw.ts: inside POST /callback handler, after request lookup
const requestContent = JSON.parse(request.requestText);
if (requestContent.type === 'pharmacy_verification' || requestContent.type === 'pharmacy_reverification') {
  const verificationData = JSON.parse(body.summary || '{}');
  await processVerificationCallback({
    pharmacyId: request.pharmacyId,
    requestId: request.id,
    approved: verificationData.approved === true,
    reason: verificationData.reason || '',
  });
}
```

**Step 5: テスト実行して成功を確認**

Run: `cd server && npx vitest run src/test/pharmacy-verification-callback-service.test.ts`

**Step 6: コミット**

```bash
git add server/src/services/pharmacy-verification-callback-service.ts server/src/test/pharmacy-verification-callback-service.test.ts server/src/routes/openclaw.ts
git commit -m "feat: process pharmacy verification callback from OpenClaw"
```

---

## Task 6: 審査ステータス確認API

**Files:**
- Create: `server/src/routes/verification.ts`
- Modify: `server/src/app.ts`（ルート登録）
- Test: `server/src/test/verification-route.test.ts`

**Step 1: テスト作成**

```typescript
// server/src/test/verification-route.test.ts
describe('GET /api/auth/verification-status', () => {
  it('returns pending status for pending_verification pharmacy', async () => {
    // Mock: pharmacy with verificationStatus='pending_verification'
    const res = await request(app)
      .get('/api/auth/verification-status')
      .query({ email: 'test@pharmacy.jp' });
    expect(res.status).toBe(200);
    expect(res.body.verificationStatus).toBe('pending_verification');
  });

  it('returns verified status', async () => {
    const res = await request(app)
      .get('/api/auth/verification-status')
      .query({ email: 'verified@pharmacy.jp' });
    expect(res.body.verificationStatus).toBe('verified');
  });

  it('returns 404 for unknown email', async () => {
    const res = await request(app)
      .get('/api/auth/verification-status')
      .query({ email: 'unknown@pharmacy.jp' });
    expect(res.status).toBe(404);
  });
});
```

**Step 2: ルート実装**

```typescript
// server/src/routes/verification.ts
import { Router, Response, Request } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies } from '../db/schema';

const router = Router();

router.get('/verification-status', async (req: Request, res: Response) => {
  const email = req.query.email;
  if (typeof email !== 'string' || !email.trim()) {
    res.status(400).json({ error: 'メールアドレスを指定してください' });
    return;
  }

  const [pharmacy] = await db.select({
    verificationStatus: pharmacies.verificationStatus,
    rejectionReason: pharmacies.rejectionReason,
  })
    .from(pharmacies)
    .where(eq(pharmacies.email, email.trim().toLowerCase()))
    .limit(1);

  if (!pharmacy) {
    res.status(404).json({ error: 'アカウントが見つかりません' });
    return;
  }

  res.json({
    verificationStatus: pharmacy.verificationStatus,
    rejectionReason: pharmacy.rejectionReason,
  });
});

export default router;
```

**Step 3: app.ts にルート登録**

`server/src/app.ts` で:
```typescript
import verificationRouter from './routes/verification';
app.use('/api/auth', verificationRouter);
```

**Step 4: テスト実行・コミット**

Run: `cd server && npx vitest run src/test/verification-route.test.ts`

```bash
git add server/src/routes/verification.ts server/src/app.ts server/src/test/verification-route.test.ts
git commit -m "feat: add verification status API endpoint"
```

---

## Task 7: 管理者手動承認API

**Files:**
- Modify: `server/src/routes/admin-pharmacies-detail.ts`
- Test: `server/src/test/admin-pharmacies-detail.test.ts`（既存があればそこに追加）

**Step 1: テスト追加**

```typescript
describe('POST /api/admin/pharmacies/:id/verify', () => {
  it('approves pending pharmacy', async () => {
    const res = await request(app)
      .post('/api/admin/pharmacies/1/verify')
      .set('Cookie', adminCookie)
      .send({ approved: true });
    expect(res.status).toBe(200);
    expect(res.body.verificationStatus).toBe('verified');
  });

  it('rejects pending pharmacy with reason', async () => {
    const res = await request(app)
      .post('/api/admin/pharmacies/1/verify')
      .set('Cookie', adminCookie)
      .send({ approved: false, reason: '情報不一致' });
    expect(res.status).toBe(200);
    expect(res.body.verificationStatus).toBe('rejected');
  });

  it('requires admin permission', async () => {
    const res = await request(app)
      .post('/api/admin/pharmacies/1/verify')
      .set('Cookie', userCookie);
    expect(res.status).toBe(403);
  });
});
```

**Step 2: エンドポイント実装**

`server/src/routes/admin-pharmacies-detail.ts` に追加:

```typescript
router.post('/:id/verify', async (req: AuthRequest, res: Response) => {
  const pharmacyId = parsePositiveInt(req.params.id);
  if (pharmacyId === null) {
    res.status(400).json({ error: 'IDが不正です' });
    return;
  }

  const { approved, reason } = req.body;
  if (typeof approved !== 'boolean') {
    res.status(400).json({ error: 'approved (boolean) を指定してください' });
    return;
  }

  const result = await processVerificationCallback({
    pharmacyId,
    requestId: 0, // manual verification
    approved,
    reason: reason || (approved ? '管理者による手動承認' : '管理者による手動却下'),
  });

  res.json(result);
});
```

**Step 3: テスト・コミット**

```bash
git add server/src/routes/admin-pharmacies-detail.ts server/src/test/admin-pharmacies-detail.test.ts
git commit -m "feat: add admin manual verification endpoint"
```

---

## Task 8: authミドルウェアに検証ステータスチェック追加

**Files:**
- Modify: `server/src/middleware/auth.ts`
- Test: `server/src/test/auth-middleware.test.ts`

**Step 1: テスト追加**

```typescript
it('rejects login for pending_verification accounts', () => {
  // Mock: pharmacy with verificationStatus='pending_verification', isActive=false
  // Expect: 403 with { error: 'アカウントは審査中です', verificationStatus: 'pending_verification' }
});
```

**Step 2: ミドルウェア変更**

`server/src/middleware/auth.ts` の `requireLogin` ミドルウェアで、`isActive` チェックに加えて `verificationStatus` を確認:

```typescript
// After existing isActive check
if (user.verificationStatus === 'pending_verification') {
  res.status(403).json({
    error: 'アカウントは現在審査中です。審査完了後にログインできます。',
    verificationStatus: 'pending_verification',
  });
  return;
}
if (user.verificationStatus === 'rejected') {
  res.status(403).json({
    error: 'アカウント申請が却下されました。詳細はメールをご確認ください。',
    verificationStatus: 'rejected',
    rejectionReason: user.rejectionReason,
  });
  return;
}
```

**Step 3: テスト・コミット**

```bash
git add server/src/middleware/auth.ts server/src/test/auth-middleware.test.ts
git commit -m "feat: add verification status check to auth middleware"
```

---

## Task 9: フロントエンド — 審査中ページ

**Files:**
- Create: `client/src/pages/VerificationPendingPage.tsx`
- Modify: `client/src/App.tsx`（ルート追加）

**Step 1: 審査中ページ作成**

```tsx
// client/src/pages/VerificationPendingPage.tsx
import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import AppCard from '../components/ui/AppCard';
import AppAlert from '../components/ui/AppAlert';
import { api } from '../api/client';

export default function VerificationPendingPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const email = searchParams.get('email') || '';
  const [status, setStatus] = useState<string>('pending_verification');
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);

  useEffect(() => {
    if (!email) return;
    const interval = setInterval(async () => {
      try {
        const res = await api.get<{
          verificationStatus: string;
          rejectionReason: string | null;
        }>(`/auth/verification-status?email=${encodeURIComponent(email)}`);
        setStatus(res.verificationStatus);
        setRejectionReason(res.rejectionReason);
        if (res.verificationStatus === 'verified') {
          clearInterval(interval);
        }
      } catch { /* ignore polling errors */ }
    }, 10000); // 10秒ごとにポーリング
    return () => clearInterval(interval);
  }, [email]);

  if (status === 'verified') {
    return (
      <div className="container mt-4" style={{ maxWidth: 600 }}>
        <AppAlert variant="success">
          アカウントが承認されました。ログインしてご利用ください。
        </AppAlert>
        <button className="btn btn-primary" onClick={() => navigate('/login')}>
          ログインページへ
        </button>
      </div>
    );
  }

  return (
    <div className="container mt-4" style={{ maxWidth: 600 }}>
      <AppCard>
        <AppCard.Header>アカウント審査中</AppCard.Header>
        <AppCard.Body>
          {status === 'rejected' ? (
            <AppAlert variant="danger">
              申請が却下されました。{rejectionReason && `理由: ${rejectionReason}`}
              <br />情報を修正して再度お申し込みください。
            </AppAlert>
          ) : (
            <>
              <p>登録申請を受け付けました。現在、薬局情報の審査を行っています。</p>
              <p>審査が完了しましたらメールでお知らせします。通常1営業日以内に完了します。</p>
              <div className="spinner-border spinner-border-sm me-2" role="status" />
              <span className="text-muted">審査中...</span>
            </>
          )}
        </AppCard.Body>
      </AppCard>
    </div>
  );
}
```

**Step 2: App.tsx にルート追加**

`client/src/App.tsx` に:
```tsx
import VerificationPendingPage from './pages/VerificationPendingPage';
// ルート定義に追加
<Route path="/verification-pending" element={<VerificationPendingPage />} />
```

**Step 3: コミット**

```bash
git add client/src/pages/VerificationPendingPage.tsx client/src/App.tsx
git commit -m "feat: add verification pending page"
```

---

## Task 10: フロントエンド — 登録ページの変更

**Files:**
- Modify: `client/src/pages/RegisterPage.tsx:60-82`

**Step 1: 登録成功時の遷移を変更**

```typescript
// Before (line 71):
navigate('/');

// After:
navigate(`/verification-pending?email=${encodeURIComponent(form.email)}`);
```

また、登録APIの成功レスポンスに `verificationStatus` が含まれるようになるため、`AuthContext` の `register` 関数が自動ログインしないよう調整（トークンが返されないため、既存の処理で自然にハンドリングされる想定）。

**Step 2: コミット**

```bash
git add client/src/pages/RegisterPage.tsx
git commit -m "feat: redirect to verification-pending after registration"
```

---

## Task 11: フロントエンド — ログインページの審査中ハンドリング

**Files:**
- Modify: `client/src/pages/LoginPage.tsx:59-84`

**Step 1: 403レスポンスの検証ステータスハンドリングを追加**

```typescript
// LoginPage.tsx: inside login error handler
catch (err) {
  if (err instanceof ApiError && err.status === 403) {
    const data = err.data as { verificationStatus?: string } | undefined;
    if (data?.verificationStatus === 'pending_verification') {
      navigate(`/verification-pending?email=${encodeURIComponent(email)}`);
      return;
    }
    if (data?.verificationStatus === 'rejected') {
      setError('アカウント申請が却下されました。詳細はメールをご確認ください。');
      return;
    }
  }
  // ... existing error handling
}
```

**Step 2: コミット**

```bash
git add client/src/pages/LoginPage.tsx
git commit -m "feat: handle verification status on login"
```

---

## Task 12: 管理者画面に検証ステータス表示・手動承認追加

**Files:**
- Modify: 管理者薬局一覧ページ（検証ステータス列追加）
- Modify: 管理者薬局詳細ページ（手動承認/却下ボタン追加）

**Step 1: 薬局一覧に verificationStatus 列追加**

管理者薬局一覧のテーブルに `verificationStatus` 列を追加。バッジ表示:
- `verified` → 緑 `承認済み`
- `pending_verification` → 黄 `審査中`
- `rejected` → 赤 `却下`
- `unverified` → グレー `未検証（旧）`

**Step 2: 薬局詳細に手動承認ボタン追加**

`verificationStatus === 'pending_verification'` のとき:
- 「承認」ボタン → `POST /api/admin/pharmacies/:id/verify { approved: true }`
- 「却下」ボタン → 理由入力ダイアログ → `POST /api/admin/pharmacies/:id/verify { approved: false, reason }`

**Step 3: コミット**

```bash
git add client/src/pages/admin/
git commit -m "feat: add verification status to admin pharmacy views"
```

---

## Task 13: 統合テスト

**Files:**
- Test: `server/src/test/pharmacy-verification-integration.test.ts`

**Step 1: E2Eフローのテスト作成**

```typescript
describe('Pharmacy verification E2E', () => {
  it('full flow: register → pending → OpenClaw callback → verified', async () => {
    // 1. Register
    const regRes = await request(app).post('/api/auth/register').send({...});
    expect(regRes.body.verificationStatus).toBe('pending_verification');

    // 2. Check status
    const statusRes = await request(app).get('/api/auth/verification-status')
      .query({ email: 'test@pharmacy.jp' });
    expect(statusRes.body.verificationStatus).toBe('pending_verification');

    // 3. Login attempt fails
    const loginRes = await request(app).post('/api/auth/login')
      .send({ email: 'test@pharmacy.jp', password: 'SecureP@ss1' });
    expect(loginRes.status).toBe(403);

    // 4. Simulate OpenClaw callback
    await processVerificationCallback({
      pharmacyId: regRes.body.pharmacyId,
      requestId: 1,
      approved: true,
      reason: '一致確認済み',
    });

    // 5. Login succeeds
    const loginRes2 = await request(app).post('/api/auth/login')
      .send({ email: 'test@pharmacy.jp', password: 'SecureP@ss1' });
    expect(loginRes2.status).toBe(200);
  });
});
```

**Step 2: テスト実行・コミット**

```bash
git add server/src/test/pharmacy-verification-integration.test.ts
git commit -m "test: add pharmacy verification integration tests"
```
