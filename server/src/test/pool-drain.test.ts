import { describe, expect, it } from 'vitest';
import { waitForPoolIdle, type PoolActivity } from '../utils/pool-drain';

function createClock() {
  let current = 0;
  return {
    now: () => current,
    sleep: async (ms: number) => {
      current += ms;
    },
  };
}

describe('waitForPoolIdle', () => {
  it('resolves once the pool has stayed idle for idleMs', async () => {
    const clock = createClock();
    const pool: PoolActivity = { totalCount: 1, idleCount: 1, waitingCount: 0 };

    await expect(waitForPoolIdle(pool, { idleMs: 300, pollMs: 50, ...clock })).resolves.toBe(true);
    expect(clock.now()).toBe(300);
  });

  it('restarts the idle window when a follow-up query starts', async () => {
    const clock = createClock();
    // 0-100ms: 1件目のクエリ実行中、100-150ms: 合間、150-250ms: 2件目のクエリ実行中
    const pool = {
      get totalCount() { return 1; },
      get idleCount() {
        const t = clock.now();
        return (t < 100 || (t >= 150 && t < 250)) ? 0 : 1;
      },
      get waitingCount() { return 0; },
    };

    await expect(waitForPoolIdle(pool, { idleMs: 300, pollMs: 50, ...clock })).resolves.toBe(true);
    expect(clock.now()).toBe(550);
  });

  it('counts queued checkouts as busy', async () => {
    const clock = createClock();
    const pool: PoolActivity = { totalCount: 0, idleCount: 0, waitingCount: 1 };

    await expect(waitForPoolIdle(pool, { idleMs: 100, timeoutMs: 1000, pollMs: 50, ...clock })).resolves.toBe(false);
  });

  it('gives up after timeoutMs while the pool stays busy', async () => {
    const clock = createClock();
    const pool: PoolActivity = { totalCount: 2, idleCount: 1, waitingCount: 0 };

    await expect(waitForPoolIdle(pool, { idleMs: 100, timeoutMs: 500, pollMs: 50, ...clock })).resolves.toBe(false);
    expect(clock.now()).toBe(500);
  });

  it('uses real timers by default', async () => {
    const pool: PoolActivity = { totalCount: 0, idleCount: 0, waitingCount: 0 };
    await expect(waitForPoolIdle(pool, { idleMs: 0 })).resolves.toBe(true);
  });
});
