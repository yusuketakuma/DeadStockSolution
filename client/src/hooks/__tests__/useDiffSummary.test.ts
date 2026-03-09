/**
 * useDiffSummary テスト (T130)
 * テスト要件: 初期状態・各セッター・導出値・リセット
 */

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useDiffSummary, DIFF_SUMMARY_INITIAL_STATE } from '../useDiffSummary';
import type { DiffSummary } from '../../pages/upload/upload-job-utils';

describe('useDiffSummary', () => {
  describe('初期状態', () => {
    it('初期状態が正しく設定される', () => {
      const { result } = renderHook(() => useDiffSummary());

      expect(result.current.diffSummary).toBeNull();
      expect(result.current.acknowledgeDeleteImpact).toBe(false);
      expect(result.current.requiresDeleteImpactAcknowledgement).toBe(false);
    });

    it('DIFF_SUMMARY_INITIAL_STATE 定数が正しい', () => {
      expect(DIFF_SUMMARY_INITIAL_STATE).toEqual({
        diffSummary: null,
        acknowledgeDeleteImpact: false,
      });
    });
  });

  describe('setDiffSummary', () => {
    it('diffSummary を設定できる', () => {
      const { result } = renderHook(() => useDiffSummary());
      const summary: DiffSummary = {
        inserted: 5,
        updated: 3,
        deactivated: 2,
        unchanged: 10,
        totalIncoming: 20,
      };

      act(() => {
        result.current.setDiffSummary(summary);
      });

      expect(result.current.diffSummary).toEqual(summary);
    });

    it('diffSummary を null にクリアできる', () => {
      const { result } = renderHook(() => useDiffSummary());
      const summary: DiffSummary = {
        inserted: 5,
        updated: 3,
        deactivated: 2,
        unchanged: 10,
        totalIncoming: 20,
      };

      act(() => {
        result.current.setDiffSummary(summary);
      });

      act(() => {
        result.current.setDiffSummary(null);
      });

      expect(result.current.diffSummary).toBeNull();
    });

    it('diffSummary を更新できる', () => {
      const { result } = renderHook(() => useDiffSummary());
      const summary1: DiffSummary = {
        inserted: 5,
        updated: 3,
        deactivated: 2,
        unchanged: 10,
        totalIncoming: 20,
      };
      const summary2: DiffSummary = {
        inserted: 10,
        updated: 5,
        deactivated: 1,
        unchanged: 15,
        totalIncoming: 31,
      };

      act(() => {
        result.current.setDiffSummary(summary1);
      });

      act(() => {
        result.current.setDiffSummary(summary2);
      });

      expect(result.current.diffSummary).toEqual(summary2);
    });
  });

  describe('setAcknowledgeDeleteImpact', () => {
    it('acknowledgeDeleteImpact を true に変更できる', () => {
      const { result } = renderHook(() => useDiffSummary());

      act(() => {
        result.current.setAcknowledgeDeleteImpact(true);
      });

      expect(result.current.acknowledgeDeleteImpact).toBe(true);
    });

    it('acknowledgeDeleteImpact を false に戻せる', () => {
      const { result } = renderHook(() => useDiffSummary());

      act(() => {
        result.current.setAcknowledgeDeleteImpact(true);
      });

      act(() => {
        result.current.setAcknowledgeDeleteImpact(false);
      });

      expect(result.current.acknowledgeDeleteImpact).toBe(false);
    });
  });

  describe('requiresDeleteImpactAcknowledgement（導出値）', () => {
    it('deactivated > 0 のとき true', () => {
      const { result } = renderHook(() => useDiffSummary());
      const summary: DiffSummary = {
        inserted: 5,
        updated: 3,
        deactivated: 2,
        unchanged: 10,
        totalIncoming: 20,
      };

      act(() => {
        result.current.setDiffSummary(summary);
      });

      expect(result.current.requiresDeleteImpactAcknowledgement).toBe(true);
    });

    it('deactivated = 0 のとき false', () => {
      const { result } = renderHook(() => useDiffSummary());
      const summary: DiffSummary = {
        inserted: 5,
        updated: 3,
        deactivated: 0,
        unchanged: 10,
        totalIncoming: 18,
      };

      act(() => {
        result.current.setDiffSummary(summary);
      });

      expect(result.current.requiresDeleteImpactAcknowledgement).toBe(false);
    });

    it('diffSummary = null のとき false', () => {
      const { result } = renderHook(() => useDiffSummary());

      expect(result.current.diffSummary).toBeNull();
      expect(result.current.requiresDeleteImpactAcknowledgement).toBe(false);
    });

    it('deactivated が複数のとき true', () => {
      const { result } = renderHook(() => useDiffSummary());
      const summary: DiffSummary = {
        inserted: 5,
        updated: 3,
        deactivated: 10,
        unchanged: 10,
        totalIncoming: 28,
      };

      act(() => {
        result.current.setDiffSummary(summary);
      });

      expect(result.current.requiresDeleteImpactAcknowledgement).toBe(true);
    });
  });

  describe('reset', () => {
    it('全状態が初期値に戻る', () => {
      const { result } = renderHook(() => useDiffSummary());
      const summary: DiffSummary = {
        inserted: 5,
        updated: 3,
        deactivated: 2,
        unchanged: 10,
        totalIncoming: 20,
      };

      // 全状態を変更
      act(() => {
        result.current.setDiffSummary(summary);
        result.current.setAcknowledgeDeleteImpact(true);
      });

      // 変更確認
      expect(result.current.diffSummary).toEqual(summary);
      expect(result.current.acknowledgeDeleteImpact).toBe(true);
      expect(result.current.requiresDeleteImpactAcknowledgement).toBe(true);

      // リセット
      act(() => {
        result.current.reset();
      });

      expect(result.current.diffSummary).toBeNull();
      expect(result.current.acknowledgeDeleteImpact).toBe(false);
      expect(result.current.requiresDeleteImpactAcknowledgement).toBe(false);
    });

    it('複数回リセットできる', () => {
      const { result } = renderHook(() => useDiffSummary());
      const summary: DiffSummary = {
        inserted: 5,
        updated: 3,
        deactivated: 2,
        unchanged: 10,
        totalIncoming: 20,
      };

      // 1回目
      act(() => {
        result.current.setDiffSummary(summary);
        result.current.setAcknowledgeDeleteImpact(true);
      });

      act(() => {
        result.current.reset();
      });

      expect(result.current.diffSummary).toBeNull();
      expect(result.current.acknowledgeDeleteImpact).toBe(false);

      // 2回目
      act(() => {
        result.current.setDiffSummary(summary);
        result.current.setAcknowledgeDeleteImpact(true);
      });

      act(() => {
        result.current.reset();
      });

      expect(result.current.diffSummary).toBeNull();
      expect(result.current.acknowledgeDeleteImpact).toBe(false);
    });
  });
});
