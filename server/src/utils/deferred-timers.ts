/**
 * Cloudflare Workers ではモジュール評価中（グローバルスコープ）にタイマーを作れない。
 * その間に登録されたタイマーをここで預かり、リクエスト処理の開始時に runDue() で
 * 期限が来たものを実行する。express-rate-limit の MemoryStore が張る期限切れキー掃除の
 * setInterval などを、リクエストのたびに遅延実行できる。
 */
export class DeferredTimerHandle {
  ref(): this { return this; }
  unref(): this { return this; }
  hasRef(): boolean { return false; }
  refresh(): this { return this; }
  close(): this { return this; }
  [Symbol.toPrimitive](): number { return 0; }
}

interface DeferredTimer {
  callback: (...args: unknown[]) => void;
  args: unknown[];
  delayMs: number;
  dueAt: number;
  repeat: boolean;
}

export interface DeferredTimerRegistry {
  setInterval(callback: unknown, delayMs?: unknown, ...args: unknown[]): DeferredTimerHandle;
  setTimeout(callback: unknown, delayMs?: unknown, ...args: unknown[]): DeferredTimerHandle;
  clear(handle: unknown): boolean;
  /** 期限が来たタイマーを実行する。interval は次回の期限を now 基準で更新する */
  runDue(now?: number): number;
  readonly size: number;
}

function normalizeDelay(delayMs: unknown): number {
  const value = Number(delayMs);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function createDeferredTimerRegistry(clock: () => number = Date.now): DeferredTimerRegistry {
  const timers = new Map<DeferredTimerHandle, DeferredTimer>();

  function register(callback: unknown, delayMs: unknown, args: unknown[], repeat: boolean): DeferredTimerHandle {
    const handle = new DeferredTimerHandle();
    if (typeof callback !== 'function') return handle;
    const delay = normalizeDelay(delayMs);
    timers.set(handle, {
      callback: callback as (...cbArgs: unknown[]) => void,
      args,
      delayMs: delay,
      dueAt: clock() + delay,
      repeat,
    });
    return handle;
  }

  return {
    setInterval: (callback, delayMs, ...args) => register(callback, delayMs, args, true),
    setTimeout: (callback, delayMs, ...args) => register(callback, delayMs, args, false),
    clear: (handle) => handle instanceof DeferredTimerHandle && timers.delete(handle),
    runDue(now = clock()) {
      let ran = 0;
      for (const [handle, timer] of [...timers]) {
        if (timer.dueAt > now) continue;
        if (timer.repeat) {
          timer.dueAt = now + timer.delayMs;
        } else {
          timers.delete(handle);
        }
        ran += 1;
        timer.callback(...timer.args);
      }
      return ran;
    },
    get size() {
      return timers.size;
    },
  };
}
