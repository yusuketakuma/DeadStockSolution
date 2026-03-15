/**
 * スケジューラ共通ヘルパー
 *
 * drug-master-scheduler / drug-package-scheduler で重複していた
 * clearSchedulerHandle を共通化したもの。
 */

/** タイマー/インターバルハンドルを安全にクリアして null を返す */
export function clearSchedulerHandle(
  handle: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval> | null,
  clearer: typeof clearTimeout,
): null {
  if (handle) {
    clearer(handle);
  }
  return null;
}
