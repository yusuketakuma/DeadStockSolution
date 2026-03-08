/**
 * useUploadForm テスト (T129)
 * テスト要件: 初期状態・各セッター・導出値・リセット
 */

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useUploadForm, UPLOAD_FORM_INITIAL_STATE } from '../useUploadForm';

describe('useUploadForm', () => {
  describe('初期状態', () => {
    it('初期状態が正しく設定される', () => {
      const { result } = renderHook(() => useUploadForm());

      expect(result.current.uploadType).toBe('dead_stock');
      expect(result.current.file).toBeNull();
      expect(result.current.applyMode).toBe('replace');
      expect(result.current.deleteMissing).toBe(false);
      expect(result.current.requiresDiffPreviewRefresh).toBe(false);
    });

    it('UPLOAD_FORM_INITIAL_STATE 定数が正しい', () => {
      expect(UPLOAD_FORM_INITIAL_STATE).toEqual({
        uploadType: 'dead_stock',
        file: null,
        applyMode: 'replace',
        deleteMissing: false,
      });
    });
  });

  describe('setUploadType', () => {
    it('uploadType を変更できる', () => {
      const { result } = renderHook(() => useUploadForm());

      act(() => {
        result.current.setUploadType('used_medication');
      });

      expect(result.current.uploadType).toBe('used_medication');
    });

    it('dead_stock に戻せる', () => {
      const { result } = renderHook(() => useUploadForm());

      act(() => {
        result.current.setUploadType('used_medication');
      });
      act(() => {
        result.current.setUploadType('dead_stock');
      });

      expect(result.current.uploadType).toBe('dead_stock');
    });
  });

  describe('setFile', () => {
    it('ファイルを設定できる', () => {
      const { result } = renderHook(() => useUploadForm());
      const file = new File(['test'], 'test.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

      act(() => {
        result.current.setFile(file);
      });

      expect(result.current.file).toBe(file);
    });

    it('ファイルを null にクリアできる', () => {
      const { result } = renderHook(() => useUploadForm());
      const file = new File(['test'], 'test.xlsx');

      act(() => {
        result.current.setFile(file);
      });
      act(() => {
        result.current.setFile(null);
      });

      expect(result.current.file).toBeNull();
    });
  });

  describe('setApplyMode', () => {
    it('applyMode を diff に変更できる', () => {
      const { result } = renderHook(() => useUploadForm());

      act(() => {
        result.current.setApplyMode('diff');
      });

      expect(result.current.applyMode).toBe('diff');
    });

    it('applyMode を replace に戻せる', () => {
      const { result } = renderHook(() => useUploadForm());

      act(() => {
        result.current.setApplyMode('diff');
      });
      act(() => {
        result.current.setApplyMode('replace');
      });

      expect(result.current.applyMode).toBe('replace');
    });
  });

  describe('setDeleteMissing', () => {
    it('deleteMissing を true に変更できる', () => {
      const { result } = renderHook(() => useUploadForm());

      act(() => {
        result.current.setDeleteMissing(true);
      });

      expect(result.current.deleteMissing).toBe(true);
    });

    it('deleteMissing を false に戻せる', () => {
      const { result } = renderHook(() => useUploadForm());

      act(() => {
        result.current.setDeleteMissing(true);
      });
      act(() => {
        result.current.setDeleteMissing(false);
      });

      expect(result.current.deleteMissing).toBe(false);
    });
  });

  describe('requiresDiffPreviewRefresh（導出値）', () => {
    it('applyMode=diff かつ deleteMissing=true のとき true', () => {
      const { result } = renderHook(() => useUploadForm());

      act(() => {
        result.current.setApplyMode('diff');
        result.current.setDeleteMissing(true);
      });

      expect(result.current.requiresDiffPreviewRefresh).toBe(true);
    });

    it('applyMode=replace かつ deleteMissing=true のとき false', () => {
      const { result } = renderHook(() => useUploadForm());

      act(() => {
        result.current.setApplyMode('replace');
        result.current.setDeleteMissing(true);
      });

      expect(result.current.requiresDiffPreviewRefresh).toBe(false);
    });

    it('applyMode=diff かつ deleteMissing=false のとき false', () => {
      const { result } = renderHook(() => useUploadForm());

      act(() => {
        result.current.setApplyMode('diff');
        result.current.setDeleteMissing(false);
      });

      expect(result.current.requiresDiffPreviewRefresh).toBe(false);
    });

    it('applyMode=replace かつ deleteMissing=false のとき false（初期値）', () => {
      const { result } = renderHook(() => useUploadForm());

      expect(result.current.requiresDiffPreviewRefresh).toBe(false);
    });
  });

  describe('reset', () => {
    it('全状態が初期値に戻る', () => {
      const { result } = renderHook(() => useUploadForm());
      const file = new File(['test'], 'test.xlsx');

      // 全状態を変更
      act(() => {
        result.current.setUploadType('used_medication');
        result.current.setFile(file);
        result.current.setApplyMode('diff');
        result.current.setDeleteMissing(true);
      });

      // 変更確認
      expect(result.current.uploadType).toBe('used_medication');
      expect(result.current.file).toBe(file);
      expect(result.current.applyMode).toBe('diff');
      expect(result.current.deleteMissing).toBe(true);
      expect(result.current.requiresDiffPreviewRefresh).toBe(true);

      // リセット
      act(() => {
        result.current.reset();
      });

      expect(result.current.uploadType).toBe('dead_stock');
      expect(result.current.file).toBeNull();
      expect(result.current.applyMode).toBe('replace');
      expect(result.current.deleteMissing).toBe(false);
      expect(result.current.requiresDiffPreviewRefresh).toBe(false);
    });
  });
});
