import { useCallback, useEffect, useRef, useState } from 'react';

export interface AutoSaveOptions {
  /** debounce の遅延ミリ秒（デフォルト: 1000ms） */
  debounceMs?: number;
  /** userId を含めて localStorage キーをスコープする（省略時はグローバル） */
  userId?: number | string;
  /** 自動保存を有効にするか（デフォルト: true） */
  enabled?: boolean;
}

export interface AutoSaveResult<T> {
  /** 保存済みの下書きが存在するか */
  hasDraft: boolean;
  /** 下書きの保存時刻（存在しない場合は null） */
  draftTimestamp: Date | null;
  /** 下書きを復元する。下書きがなければ null を返す */
  restoreDraft: () => T | null;
  /** 下書きをクリアする */
  clearDraft: () => void;
  /** 自動保存の状態 */
  savingStatus: 'idle' | 'saving' | 'saved';
}

interface DraftEnvelope<T> {
  data: T;
  savedAt: string; // ISO 8601
}

/**
 * localStorage キーを組み立てる
 */
function buildStorageKey(formId: string, userId?: number | string): string {
  if (userId != null) {
    return `draft:${formId}:${userId}`;
  }
  return `draft:${formId}`;
}

/**
 * localStorage から下書きエンベロープを安全に読み出す
 */
function readDraft<T>(key: string): DraftEnvelope<T> | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'data' in parsed &&
      'savedAt' in parsed
    ) {
      return parsed as DraftEnvelope<T>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * localStorage に下書きを保存する
 */
function writeDraft<T>(key: string, data: T): boolean {
  const envelope: DraftEnvelope<T> = {
    data,
    savedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(key, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

/**
 * フォーム編集途中データの自動保存フック。
 * debounce 付きで localStorage に保存し、復元・クリア API を提供する。
 */
export function useAutoSave<T>(
  formId: string,
  currentData: T,
  options: AutoSaveOptions = {},
): AutoSaveResult<T> {
  const { debounceMs = 1000, userId, enabled = true } = options;

  const storageKey = buildStorageKey(formId, userId);

  // 初期化時に下書きの存在を判定
  const initialEnvelope = useRef(readDraft<T>(storageKey));
  const [hasDraft, setHasDraft] = useState(initialEnvelope.current !== null);
  const [draftTimestamp, setDraftTimestamp] = useState<Date | null>(
    initialEnvelope.current ? new Date(initialEnvelope.current.savedAt) : null,
  );
  const [savingStatus, setSavingStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  // currentData の最新値を ref で保持（debounce コールバック内で参照）
  const dataRef = useRef(currentData);
  dataRef.current = currentData;

  // storageKey の最新値を ref で保持
  const storageKeyRef = useRef(storageKey);
  storageKeyRef.current = storageKey;

  // debounce タイマー ID
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 初回レンダリングかどうか（初回データ設定時は保存しない）
  const isFirstRender = useRef(true);

  // formId/userId 変更時に保存先キーを切り替え、下書き状態を再評価する
  useEffect(() => {
    const envelope = readDraft<T>(storageKey);
    setHasDraft(envelope !== null);
    setDraftTimestamp(envelope ? new Date(envelope.savedAt) : null);
    setSavingStatus('idle');
    isFirstRender.current = true;

    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (statusTimerRef.current !== null) {
      clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
  }, [storageKey]);

  // debounce 付きの自動保存
  useEffect(() => {
    if (!enabled) return;

    // 初回レンダリング時はスキップ（初期値を保存しない）
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // 前のタイマーをキャンセル
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    if (statusTimerRef.current !== null) {
      clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }

    setSavingStatus('saving');

    timerRef.current = setTimeout(() => {
      const saved = writeDraft(storageKeyRef.current, dataRef.current);
      if (!saved) {
        setSavingStatus('idle');
        return;
      }
      setSavingStatus('saved');
      setHasDraft(true);
      setDraftTimestamp(new Date());

      // 一定時間後に idle に戻す
      statusTimerRef.current = setTimeout(() => {
        setSavingStatus('idle');
        statusTimerRef.current = null;
      }, 1500);
    }, debounceMs);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      if (statusTimerRef.current !== null) {
        clearTimeout(statusTimerRef.current);
        statusTimerRef.current = null;
      }
    };
    // JSON.stringify で変更検知（オブジェクト参照だと毎回発火するため）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(currentData), debounceMs, enabled]);

  // コンポーネントアンマウント時にタイマーをクリーンアップ
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      if (statusTimerRef.current !== null) {
        clearTimeout(statusTimerRef.current);
        statusTimerRef.current = null;
      }
    };
  }, []);

  const restoreDraft = useCallback((): T | null => {
    const envelope = readDraft<T>(storageKeyRef.current);
    if (!envelope) return null;
    return envelope.data;
  }, []);

  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(storageKeyRef.current);
    } catch {
      // localStorage が利用できない環境でも UI 状態はクリアする
    }
    setHasDraft(false);
    setDraftTimestamp(null);
    setSavingStatus('idle');
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (statusTimerRef.current !== null) {
      clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
  }, []);

  return {
    hasDraft,
    draftTimestamp,
    restoreDraft,
    clearDraft,
    savingStatus,
  };
}
