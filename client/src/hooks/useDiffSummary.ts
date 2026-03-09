/**
 * useDiffSummary - 差分サマリー状態管理フック (T130)
 *
 * diffSummary / acknowledgeDeleteImpact を一元管理し、
 * requiresDeleteImpactAcknowledgement の導出値を提供する軽量フック。
 */

import { useState, useCallback } from 'react';
import type { DiffSummary } from '../pages/upload/upload-job-utils';

// === 型定義 ===

export interface UseDiffSummaryReturn {
  /** 差分サマリー */
  diffSummary: DiffSummary | null;
  /** 差分サマリーを設定 */
  setDiffSummary: React.Dispatch<React.SetStateAction<DiffSummary | null>>;
  /** 削除影響を確認したか */
  acknowledgeDeleteImpact: boolean;
  /** 削除影響確認フラグを設定 */
  setAcknowledgeDeleteImpact: (value: boolean) => void;
  /** 削除影響確認が必要か（deactivated > 0 のとき true） */
  requiresDeleteImpactAcknowledgement: boolean;
  /** 全状態を初期値に戻す */
  reset: () => void;
}

// === 初期状態定数 ===

export const DIFF_SUMMARY_INITIAL_STATE = {
  diffSummary: null as DiffSummary | null,
  acknowledgeDeleteImpact: false,
} as const;

// === メインフック ===

export function useDiffSummary(): UseDiffSummaryReturn {
  const [diffSummary, setDiffSummary] = useState<DiffSummary | null>(
    DIFF_SUMMARY_INITIAL_STATE.diffSummary,
  );
  const [acknowledgeDeleteImpact, setAcknowledgeDeleteImpact] = useState<boolean>(
    DIFF_SUMMARY_INITIAL_STATE.acknowledgeDeleteImpact,
  );

  // 導出値: deactivated > 0 のとき true
  const requiresDeleteImpactAcknowledgement = (diffSummary?.deactivated ?? 0) > 0;

  const handleSetAcknowledgeDeleteImpact = useCallback((value: boolean) => {
    setAcknowledgeDeleteImpact(value);
  }, []);

  const reset = useCallback(() => {
    setDiffSummary(DIFF_SUMMARY_INITIAL_STATE.diffSummary);
    setAcknowledgeDeleteImpact(DIFF_SUMMARY_INITIAL_STATE.acknowledgeDeleteImpact);
  }, []);

  return {
    diffSummary,
    setDiffSummary,
    acknowledgeDeleteImpact,
    setAcknowledgeDeleteImpact: handleSetAcknowledgeDeleteImpact,
    requiresDeleteImpactAcknowledgement,
    reset,
  };
}
