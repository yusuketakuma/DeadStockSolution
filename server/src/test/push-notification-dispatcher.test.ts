import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendToPharmacy: vi.fn().mockResolvedValue(undefined),
  loggerWarn: vi.fn(),
}));

vi.mock('../services/push-dispatch-service', () => ({
  sendToPharmacy: mocks.sendToPharmacy,
  sendToMultiple: vi.fn(),
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: mocks.loggerWarn,
    error: vi.fn(),
  },
}));

import { dispatchNotificationPush } from '../services/push-notification-dispatcher';

describe('push-notification-dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes alert notifications to /alerts even when legacy referenceType is match', async () => {
    await dispatchNotificationPush({
      pharmacyId: 42,
      type: 'alert_near_expiry',
      title: '期限切迫在庫の予兆があります',
      message: '在庫を確認してください',
      referenceType: 'match',
      referenceId: undefined,
    });

    expect(mocks.sendToPharmacy).toHaveBeenCalledWith(42, expect.objectContaining({
      data: expect.objectContaining({
        url: '/alerts',
        type: 'alert_near_expiry',
        category: 'alerts',
      }),
    }));
  });

  it('routes matching refresh completion pushes to /matching', async () => {
    await dispatchNotificationPush({
      pharmacyId: 42,
      type: 'matching_refresh_complete',
      title: 'マッチング更新完了',
      message: '12件の候補が見つかりました',
      referenceType: undefined,
      referenceId: undefined,
    });

    expect(mocks.sendToPharmacy).toHaveBeenCalledWith(42, expect.objectContaining({
      data: expect.objectContaining({
        url: '/matching',
        type: 'matching_refresh_complete',
        category: 'matching',
      }),
    }));
  });

  it('routes request update pushes to the specific request thread when referenceId exists', async () => {
    await dispatchNotificationPush({
      pharmacyId: 42,
      type: 'request_update',
      title: '要望が更新されました',
      message: '要望 #88 を確認してください',
      referenceType: 'request',
      referenceId: 88,
    });

    expect(mocks.sendToPharmacy).toHaveBeenCalledWith(42, expect.objectContaining({
      data: expect.objectContaining({
        url: '/requests?requestId=88',
        type: 'request_update',
        category: 'requests',
      }),
    }));
  });
});
