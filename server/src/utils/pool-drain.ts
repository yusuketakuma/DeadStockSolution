/** pg Pool の利用状況（pg.Pool が公開するカウンタ） */
export interface PoolActivity {
  readonly totalCount: number;
  readonly idleCount: number;
  readonly waitingCount: number;
}

export interface WaitForPoolIdleOptions {
  /** この時間だけ連続して未使用なら「処理が終わった」とみなす */
  idleMs?: number;
  /** これを超えたら待つのをやめる（Workers の waitUntil は応答後 30 秒まで） */
  timeoutMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

function isPoolBusy(pool: PoolActivity): boolean {
  return pool.totalCount - pool.idleCount + pool.waitingCount > 0;
}

/**
 * レスポンス送信後も続く非同期処理（await せずに起動したログ書き込みなど）が
 * DB を使い終わるまで待つ。連続したクエリの合間を終了と誤認しないよう、
 * 未使用状態が idleMs 続いた時点で完了とする。
 *
 * @returns 未使用状態になれば true、timeoutMs を超えたら false
 */
export async function waitForPoolIdle(pool: PoolActivity, options: WaitForPoolIdleOptions = {}): Promise<boolean> {
  const {
    idleMs = 300,
    timeoutMs = 20_000,
    pollMs = 50,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
  } = options;

  const deadline = now() + timeoutMs;
  let idleSince: number | null = null;

  while (now() < deadline) {
    if (isPoolBusy(pool)) {
      idleSince = null;
    } else {
      idleSince ??= now();
      if (now() - idleSince >= idleMs) return true;
    }
    await sleep(pollMs);
  }
  return false;
}
