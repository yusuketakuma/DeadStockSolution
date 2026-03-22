/**
 * SLO Tracking Service (v0 — in-memory)
 *
 * ヘルスチェック失敗などの SLO 違反を記録・取得するシンプルなサービス。
 * v0 はメモリ内保存のみ。プロセス再起動で履歴はリセットされる。
 */

export type SloBreachType = 'db_health' | 'readiness' | 'rate_limit' | 'custom';

export interface SloBreach {
  id: number;
  type: SloBreachType;
  details: string;
  timestamp: string; // ISO 8601
}

const MAX_STORED_BREACHES = 500;

let nextId = 1;
const breaches: SloBreach[] = [];

/**
 * SLO 違反を記録する。
 *
 * @param type   違反の種別
 * @param details  違反の詳細説明
 */
export function recordBreach(type: SloBreachType, details: string): SloBreach {
  const breach: SloBreach = {
    id: nextId++,
    type,
    details,
    timestamp: new Date().toISOString(),
  };

  breaches.push(breach);

  // 上限を超えた分は古いものから削除する
  if (breaches.length > MAX_STORED_BREACHES) {
    breaches.splice(0, breaches.length - MAX_STORED_BREACHES);
  }

  return breach;
}

/**
 * 最近の SLO 違反を新しい順で取得する。
 *
 * @param limit 取得件数上限 (default: 50, max: 200)
 */
export function getBreaches(limit = 50): SloBreach[] {
  const safeLimit = Math.min(Math.max(1, limit), 200);
  return breaches.slice(-safeLimit).reverse();
}

/**
 * 全 SLO 違反を消去する（テスト・手動クリア用）。
 */
export function clearBreaches(): void {
  breaches.length = 0;
  nextId = 1;
}

/**
 * 現在保存されている違反の件数を返す。
 */
export function getBreachCount(): number {
  return breaches.length;
}
