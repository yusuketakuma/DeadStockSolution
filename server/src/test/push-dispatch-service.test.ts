/**
 * push-dispatch-service.test.ts
 * TDD: プッシュ通知ディスパッチサービスのテスト
 * - sendToPharmacy: 薬局IDに紐づく全購読へ送信
 * - sendToMultiple: 複数薬局へ一括送信
 * - 410 Gone / 404 Not Found で購読を自動削除
 * - VAPID 未設定時は早期リターン
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── vi.hoisted でモック定義 ──
const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  },
  preferences: {
    getPushNotificationPreferences: vi.fn(),
  },
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  webpush: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({ db: mocks.db }));
vi.mock('../services/logger', () => ({ logger: mocks.logger }));
vi.mock('../services/push-notification-preferences-service', () => ({
  getPushNotificationPreferences: mocks.preferences.getPushNotificationPreferences,
}));
vi.mock('web-push', () => ({
  default: mocks.webpush,
  setVapidDetails: mocks.webpush.setVapidDetails,
  sendNotification: mocks.webpush.sendNotification,
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => ({ _tag: 'eq', args })),
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
}));

// ── テスト対象のインポート（モック後） ──
// sendToPharmacy, sendToMultiple は VAPID 環境変数に依存するため
// テスト内で動的にインポートする

const testPayload = {
  title: 'テスト通知',
  body: 'テスト本文です',
  data: {
    url: '/proposals/123',
    type: 'proposal_received',
  },
};

const makeSub = (id: number, pharmacyId: number, endpoint: string) => ({
  id,
  pharmacyId,
  endpoint,
  p256dh: `p256dh-key-${id}`,
  auth: `auth-key-${id}`,
  userAgent: 'TestBrowser/1.0',
  createdAt: '2025-01-01T00:00:00.000Z',
  lastUsedAt: null,
});

describe('push-dispatch-service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.preferences.getPushNotificationPreferences.mockResolvedValue({
      categories: {
        proposals: true,
        requests: true,
        comments: true,
        matching: true,
        groups: true,
        alerts: true,
        admin: true,
      },
      allowCritical: true,
    });
    // VAPID 環境変数を設定
    vi.stubEnv('VAPID_PUBLIC_KEY', 'test-public-key');
    vi.stubEnv('VAPID_PRIVATE_KEY', 'test-private-key');
    vi.stubEnv('VAPID_SUBJECT', 'mailto:test@example.com');
  });

  // ── Drizzle クエリのチェーンモック ──
  function setupSelectMock(rows: unknown[]) {
    const where = vi.fn().mockResolvedValue(rows);
    const from = vi.fn().mockReturnValue({ where });
    mocks.db.select.mockReturnValue({ from });
    return { from, where };
  }

  function setupDeleteMock() {
    const where = vi.fn().mockResolvedValue(undefined);
    const deleteMock = mocks.db.delete.mockReturnValue({ where });
    return { deleteMock, where };
  }

  function setupUpdateMock() {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    mocks.db.update.mockReturnValue({ set });
    return { set, where };
  }

  async function importService() {
    // 動的インポートでモジュールキャッシュをリセット
    const mod = await import('../services/push-dispatch-service');
    return mod;
  }

  describe('sendToPharmacy', () => {
    it('2つの購読に正常送信 → sent: 2, failed: 0, cleaned: 0', async () => {
      const subs = [
        makeSub(1, 10, 'https://push.example.com/sub1'),
        makeSub(2, 10, 'https://push.example.com/sub2'),
      ];
      setupSelectMock(subs);
      setupUpdateMock();
      mocks.webpush.sendNotification.mockResolvedValue({ statusCode: 201 });

      const { sendToPharmacy } = await importService();
      const result = await sendToPharmacy(10, testPayload);

      expect(result).toEqual({ sent: 2, failed: 0, cleaned: 0 });
      expect(mocks.webpush.sendNotification).toHaveBeenCalledTimes(2);
      // 送信ペイロードの検証
      const callArg = mocks.webpush.sendNotification.mock.calls[0];
      expect(callArg[0]).toEqual({
        endpoint: 'https://push.example.com/sub1',
        keys: { p256dh: 'p256dh-key-1', auth: 'auth-key-1' },
      });
      expect(JSON.parse(callArg[1] as string)).toEqual(testPayload);
    });

    it('1つの購読が 410 Gone → sent: 0, failed: 0, cleaned: 1（購読削除）', async () => {
      const subs = [makeSub(1, 10, 'https://push.example.com/sub1')];
      setupSelectMock(subs);
      const { where: deleteWhere } = setupDeleteMock();

      const goneError = Object.assign(new Error('Gone'), { statusCode: 410 });
      mocks.webpush.sendNotification.mockRejectedValue(goneError);

      const { sendToPharmacy } = await importService();
      const result = await sendToPharmacy(10, testPayload);

      expect(result).toEqual({ sent: 0, failed: 0, cleaned: 1 });
      expect(mocks.db.delete).toHaveBeenCalledTimes(1);
      expect(deleteWhere).toHaveBeenCalledTimes(1);
    });

    it('1つの購読が 404 Not Found → sent: 0, failed: 0, cleaned: 1（購読削除）', async () => {
      const subs = [makeSub(1, 10, 'https://push.example.com/sub1')];
      setupSelectMock(subs);
      setupDeleteMock();

      const notFoundError = Object.assign(new Error('Not Found'), { statusCode: 404 });
      mocks.webpush.sendNotification.mockRejectedValue(notFoundError);

      const { sendToPharmacy } = await importService();
      const result = await sendToPharmacy(10, testPayload);

      expect(result).toEqual({ sent: 0, failed: 0, cleaned: 1 });
      expect(mocks.db.delete).toHaveBeenCalledTimes(1);
    });

    it('送信エラー（410/404以外）→ failed にカウント', async () => {
      const subs = [makeSub(1, 10, 'https://push.example.com/sub1')];
      setupSelectMock(subs);

      const serverError = Object.assign(new Error('Server Error'), { statusCode: 500 });
      mocks.webpush.sendNotification.mockRejectedValue(serverError);

      const { sendToPharmacy } = await importService();
      const result = await sendToPharmacy(10, testPayload);

      expect(result).toEqual({ sent: 0, failed: 1, cleaned: 0 });
      expect(mocks.logger.warn).toHaveBeenCalled();
    });

    it('購読が0件 → sent: 0, failed: 0, cleaned: 0', async () => {
      setupSelectMock([]);

      const { sendToPharmacy } = await importService();
      const result = await sendToPharmacy(10, testPayload);

      expect(result).toEqual({ sent: 0, failed: 0, cleaned: 0 });
      expect(mocks.webpush.sendNotification).not.toHaveBeenCalled();
    });

    it('VAPID 未設定 → 早期リターン、エラーなし', async () => {
      vi.stubEnv('VAPID_PUBLIC_KEY', '');
      vi.stubEnv('VAPID_PRIVATE_KEY', '');
      vi.stubEnv('VAPID_SUBJECT', '');

      const { sendToPharmacy } = await importService();
      const result = await sendToPharmacy(10, testPayload);

      expect(result).toEqual({ sent: 0, failed: 0, cleaned: 0 });
      expect(mocks.webpush.sendNotification).not.toHaveBeenCalled();
      expect(mocks.logger.warn).toHaveBeenCalled();
    });

    it('混在: 1成功 + 1が410 → sent: 1, failed: 0, cleaned: 1', async () => {
      const subs = [
        makeSub(1, 10, 'https://push.example.com/sub1'),
        makeSub(2, 10, 'https://push.example.com/sub2'),
      ];
      setupSelectMock(subs);
      setupDeleteMock();
      setupUpdateMock();

      mocks.webpush.sendNotification
        .mockResolvedValueOnce({ statusCode: 201 })
        .mockRejectedValueOnce(Object.assign(new Error('Gone'), { statusCode: 410 }));

      const { sendToPharmacy } = await importService();
      const result = await sendToPharmacy(10, testPayload);

      expect(result).toEqual({ sent: 1, failed: 0, cleaned: 1 });
    });

    it('無効カテゴリは送信をスキップする', async () => {
      mocks.preferences.getPushNotificationPreferences.mockResolvedValue({
        categories: {
          proposals: false,
          requests: true,
          comments: true,
          matching: true,
          groups: true,
          alerts: true,
          admin: true,
        },
        allowCritical: false,
      });

      const { sendToPharmacy } = await importService();
      const result = await sendToPharmacy(10, testPayload);

      expect(result).toEqual({ sent: 0, failed: 0, cleaned: 0 });
      expect(mocks.webpush.sendNotification).not.toHaveBeenCalled();
    });

    it('allowCritical が有効なら高優先通知は送信する', async () => {
      const subs = [makeSub(1, 10, 'https://push.example.com/sub1')];
      setupSelectMock(subs);
      setupUpdateMock();
      mocks.preferences.getPushNotificationPreferences.mockResolvedValue({
        categories: {
          proposals: false,
          requests: true,
          comments: true,
          matching: true,
          groups: true,
          alerts: true,
          admin: true,
        },
        allowCritical: true,
      });
      mocks.webpush.sendNotification.mockResolvedValue({ statusCode: 201 });

      const { sendToPharmacy } = await importService();
      const result = await sendToPharmacy(10, testPayload);

      expect(result).toEqual({ sent: 1, failed: 0, cleaned: 0 });
      expect(mocks.webpush.sendNotification).toHaveBeenCalledTimes(1);
    });
  });

  describe('sendToMultiple', () => {
    it('3つの薬局へ送信 → 全結果を集約', async () => {
      // sendToPharmacy を3回呼ぶので、selectモックを3回分設定
      const sub1 = makeSub(1, 10, 'https://push.example.com/sub1');
      const sub2 = makeSub(2, 20, 'https://push.example.com/sub2');
      const sub3 = makeSub(3, 30, 'https://push.example.com/sub3');

      // 各呼び出しで異なる購読を返す
      let callCount = 0;
      mocks.db.select.mockImplementation(() => {
        callCount++;
        const subs = callCount === 1 ? [sub1] : callCount === 2 ? [sub2] : [sub3];
        const where = vi.fn().mockResolvedValue(subs);
        const from = vi.fn().mockReturnValue({ where });
        return { from };
      });
      setupUpdateMock();
      mocks.webpush.sendNotification.mockResolvedValue({ statusCode: 201 });

      const { sendToMultiple } = await importService();
      const result = await sendToMultiple([10, 20, 30], testPayload);

      expect(result).toEqual({ sent: 3, failed: 0, cleaned: 0 });
      expect(mocks.webpush.sendNotification).toHaveBeenCalledTimes(3);
    });

    it('空の薬局ID配列 → sent: 0, failed: 0, cleaned: 0', async () => {
      const { sendToMultiple } = await importService();
      const result = await sendToMultiple([], testPayload);

      expect(result).toEqual({ sent: 0, failed: 0, cleaned: 0 });
    });

    it('VAPID 未設定 → 早期リターン', async () => {
      vi.stubEnv('VAPID_PUBLIC_KEY', '');
      vi.stubEnv('VAPID_PRIVATE_KEY', '');
      vi.stubEnv('VAPID_SUBJECT', '');

      const { sendToMultiple } = await importService();
      const result = await sendToMultiple([10, 20], testPayload);

      expect(result).toEqual({ sent: 0, failed: 0, cleaned: 0 });
      expect(mocks.webpush.sendNotification).not.toHaveBeenCalled();
    });
  });
});
