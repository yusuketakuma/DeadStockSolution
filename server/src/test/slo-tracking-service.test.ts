import { afterEach, describe, expect, it } from 'vitest';
import {
  clearBreaches,
  getBreachCount,
  getBreaches,
  recordBreach,
} from '../services/slo-tracking-service';

afterEach(() => {
  clearBreaches();
});

describe('recordBreach', () => {
  it('新しい違反を記録してオブジェクトを返す', () => {
    const breach = recordBreach('db_health', 'DB 接続タイムアウト');

    expect(breach.id).toBeGreaterThan(0);
    expect(breach.type).toBe('db_health');
    expect(breach.details).toBe('DB 接続タイムアウト');
    expect(() => new Date(breach.timestamp)).not.toThrow();
  });

  it('複数の違反を順番に記録する', () => {
    recordBreach('db_health', '1回目');
    recordBreach('readiness', '2回目');
    recordBreach('rate_limit', '3回目');

    expect(getBreachCount()).toBe(3);
  });

  it('ID は記録するたびにインクリメントされる', () => {
    const b1 = recordBreach('db_health', 'a');
    const b2 = recordBreach('readiness', 'b');

    expect(b2.id).toBeGreaterThan(b1.id);
  });

  it('timestamp は ISO 8601 形式である', () => {
    const breach = recordBreach('custom', 'テスト');

    expect(new Date(breach.timestamp).toISOString()).toBe(breach.timestamp);
  });
});

describe('getBreaches', () => {
  it('空のときは空配列を返す', () => {
    expect(getBreaches()).toEqual([]);
  });

  it('新しい順（降順）で返す', () => {
    recordBreach('db_health', '古い');
    recordBreach('readiness', '新しい');

    const result = getBreaches();

    expect(result[0].details).toBe('新しい');
    expect(result[1].details).toBe('古い');
  });

  it('limit パラメータで件数を制限する', () => {
    for (let i = 0; i < 10; i++) {
      recordBreach('db_health', `breach-${i}`);
    }

    const result = getBreaches(3);

    expect(result).toHaveLength(3);
  });

  it('limit に 200 を超える値を渡しても 200 件に丸める', () => {
    for (let i = 0; i < 250; i++) {
      recordBreach('db_health', `breach-${i}`);
    }

    const result = getBreaches(999);

    expect(result.length).toBeLessThanOrEqual(200);
  });

  it('limit に 0 以下を渡しても 1 件に丸める', () => {
    recordBreach('db_health', 'breach');

    const result = getBreaches(0);

    expect(result).toHaveLength(1);
  });

  it('limit を省略したときは最大 50 件を返す', () => {
    for (let i = 0; i < 60; i++) {
      recordBreach('db_health', `breach-${i}`);
    }

    const result = getBreaches();

    expect(result).toHaveLength(50);
  });
});

describe('clearBreaches', () => {
  it('全違反を消去する', () => {
    recordBreach('db_health', 'a');
    recordBreach('readiness', 'b');

    clearBreaches();

    expect(getBreachCount()).toBe(0);
    expect(getBreaches()).toEqual([]);
  });

  it('消去後も新しい違反を記録できる', () => {
    recordBreach('db_health', '消去前');
    clearBreaches();

    const breach = recordBreach('readiness', '消去後');

    expect(breach.id).toBeGreaterThan(0);
    expect(getBreachCount()).toBe(1);
  });
});

describe('getBreachCount', () => {
  it('初期状態は 0 を返す', () => {
    expect(getBreachCount()).toBe(0);
  });

  it('記録するたびにカウントが増える', () => {
    recordBreach('db_health', 'a');
    expect(getBreachCount()).toBe(1);

    recordBreach('readiness', 'b');
    expect(getBreachCount()).toBe(2);
  });
});
