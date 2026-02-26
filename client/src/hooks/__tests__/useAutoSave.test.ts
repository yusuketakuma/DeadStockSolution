import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAutoSave } from '../useAutoSave';

// localStorage のモック
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((_index: number) => null),
    _store: () => store,
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

describe('useAutoSave', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── 初期状態 ──────────────────────────────────

  it('should have no draft initially when localStorage is empty', () => {
    const { result } = renderHook(() =>
      useAutoSave('test-form', { name: 'initial' }),
    );

    expect(result.current.hasDraft).toBe(false);
    expect(result.current.draftTimestamp).toBeNull();
    expect(result.current.savingStatus).toBe('idle');
  });

  it('should detect existing draft on mount', () => {
    // 事前に localStorage に下書きを保存
    const savedAt = new Date('2026-01-15T10:00:00Z').toISOString();
    localStorageMock.setItem(
      'draft:test-form',
      JSON.stringify({ data: { name: 'saved' }, savedAt }),
    );

    const { result } = renderHook(() =>
      useAutoSave('test-form', { name: 'current' }),
    );

    expect(result.current.hasDraft).toBe(true);
    expect(result.current.draftTimestamp).toEqual(new Date(savedAt));
  });

  // ── debounce 自動保存 ──────────────────────────

  it('should auto-save data after debounce delay', () => {
    const { result, rerender } = renderHook(
      ({ data }) => useAutoSave('test-form', data),
      { initialProps: { data: { name: 'initial' } } },
    );

    // 初期状態
    expect(result.current.hasDraft).toBe(false);

    // データ変更
    rerender({ data: { name: 'changed' } });

    // debounce 前は保存されていない
    expect(localStorageMock.setItem).not.toHaveBeenCalledWith(
      'draft:test-form',
      expect.any(String),
    );
    expect(result.current.savingStatus).toBe('saving');

    // debounce 完了（1000ms）
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // localStorage に保存されている
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'draft:test-form',
      expect.stringContaining('"name":"changed"'),
    );
    expect(result.current.hasDraft).toBe(true);
    expect(result.current.savingStatus).toBe('saved');

    // saved → idle に戻る（1500ms 後）
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(result.current.savingStatus).toBe('idle');
  });

  it('should debounce rapid changes and only save the latest', () => {
    const { rerender } = renderHook(
      ({ data }) => useAutoSave('test-form', data, { debounceMs: 500 }),
      { initialProps: { data: { value: 1 } } },
    );

    // 連続して変更
    rerender({ data: { value: 2 } });
    act(() => { vi.advanceTimersByTime(200); });

    rerender({ data: { value: 3 } });
    act(() => { vi.advanceTimersByTime(200); });

    rerender({ data: { value: 4 } });

    // まだ保存されていない
    const callsBefore = localStorageMock.setItem.mock.calls.filter(
      (c: string[]) => c[0] === 'draft:test-form',
    );
    expect(callsBefore).toHaveLength(0);

    // debounce 完了
    act(() => { vi.advanceTimersByTime(500); });

    // 最新の値のみ保存されている
    const callsAfter = localStorageMock.setItem.mock.calls.filter(
      (c: string[]) => c[0] === 'draft:test-form',
    );
    expect(callsAfter).toHaveLength(1);
    expect(callsAfter[0][1]).toContain('"value":4');
  });

  it('should clear pending timers on unmount', () => {
    const { rerender, unmount } = renderHook(
      ({ data }) => useAutoSave('cleanup-test', data),
      { initialProps: { data: { value: 'initial' } } },
    );

    rerender({ data: { value: 'changed' } });
    act(() => { vi.advanceTimersByTime(1000); });

    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('should keep idle when draft write fails', () => {
    localStorageMock.setItem.mockImplementationOnce(() => {
      throw new Error('quota exceeded');
    });

    const { result, rerender } = renderHook(
      ({ data }) => useAutoSave('write-fail', data),
      { initialProps: { data: { value: 'initial' } } },
    );

    rerender({ data: { value: 'changed' } });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.savingStatus).toBe('idle');
    expect(result.current.hasDraft).toBe(false);
  });

  // ── 下書き復元 ──────────────────────────────────

  it('should restore draft data correctly', () => {
    const savedData = { name: 'restored name', email: 'test@example.com' };
    localStorageMock.setItem(
      'draft:restore-test',
      JSON.stringify({ data: savedData, savedAt: new Date().toISOString() }),
    );

    const { result } = renderHook(() =>
      useAutoSave('restore-test', { name: '', email: '' }),
    );

    expect(result.current.hasDraft).toBe(true);

    let restored: typeof savedData | null = null;
    act(() => {
      restored = result.current.restoreDraft();
    });

    expect(restored).toEqual(savedData);
  });

  it('should return null when no draft to restore', () => {
    const { result } = renderHook(() =>
      useAutoSave('no-draft', { value: 0 }),
    );

    let restored: { value: number } | null = null;
    act(() => {
      restored = result.current.restoreDraft();
    });

    expect(restored).toBeNull();
  });

  // ── 下書きクリア ──────────────────────────────────

  it('should clear draft from localStorage', () => {
    localStorageMock.setItem(
      'draft:clear-test',
      JSON.stringify({ data: { x: 1 }, savedAt: new Date().toISOString() }),
    );

    const { result } = renderHook(() =>
      useAutoSave('clear-test', { x: 0 }),
    );

    expect(result.current.hasDraft).toBe(true);

    act(() => {
      result.current.clearDraft();
    });

    expect(result.current.hasDraft).toBe(false);
    expect(result.current.draftTimestamp).toBeNull();
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('draft:clear-test');
  });

  // ── 独立した formId ────────────────────────────

  it('should isolate drafts by formId', () => {
    const { result: resultA, rerender: rerenderA } = renderHook(
      ({ data }) => useAutoSave('form-a', data),
      { initialProps: { data: { value: 'a-initial' } } },
    );

    const { result: resultB, rerender: rerenderB } = renderHook(
      ({ data }) => useAutoSave('form-b', data),
      { initialProps: { data: { value: 'b-initial' } } },
    );

    // form-a を変更して保存
    rerenderA({ data: { value: 'a-changed' } });
    act(() => { vi.advanceTimersByTime(1000); });

    expect(resultA.current.hasDraft).toBe(true);
    expect(resultB.current.hasDraft).toBe(false);

    // form-b を変更して保存
    rerenderB({ data: { value: 'b-changed' } });
    act(() => { vi.advanceTimersByTime(1000); });

    expect(resultB.current.hasDraft).toBe(true);

    // form-a をクリアしても form-b は残る
    act(() => { resultA.current.clearDraft(); });
    expect(resultA.current.hasDraft).toBe(false);

    const restoredB = resultB.current.restoreDraft();
    expect(restoredB).toEqual({ value: 'b-changed' });
  });

  // ── userId によるスコープ ─────────────────────────

  it('should scope storage key by userId when provided', () => {
    const { rerender } = renderHook(
      ({ data }) => useAutoSave('user-form', data, { userId: 42 }),
      { initialProps: { data: { name: 'test' } } },
    );

    rerender({ data: { name: 'changed' } });
    act(() => { vi.advanceTimersByTime(1000); });

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'draft:user-form:42',
      expect.any(String),
    );
  });

  it('should re-detect draft when formId changes', () => {
    const savedAt = new Date('2026-02-25T09:30:00Z').toISOString();
    localStorageMock.setItem(
      'draft:form-b',
      JSON.stringify({ data: { value: 'draft-b' }, savedAt }),
    );

    const { result, rerender } = renderHook(
      ({ formId, data }) => useAutoSave(formId, data),
      { initialProps: { formId: 'form-a', data: { value: 'a' } } },
    );

    expect(result.current.hasDraft).toBe(false);
    expect(result.current.draftTimestamp).toBeNull();

    rerender({ formId: 'form-b', data: { value: 'b' } });

    expect(result.current.hasDraft).toBe(true);
    expect(result.current.draftTimestamp).toEqual(new Date(savedAt));
    expect(result.current.restoreDraft()).toEqual({ value: 'draft-b' });
  });

  // ── enabled オプション ──────────────────────────

  it('should not auto-save when enabled is false', () => {
    const { rerender } = renderHook(
      ({ data, enabled }) => useAutoSave('disabled-form', data, { enabled }),
      { initialProps: { data: { v: 1 }, enabled: false } },
    );

    rerender({ data: { v: 2 }, enabled: false });
    act(() => { vi.advanceTimersByTime(2000); });

    const calls = localStorageMock.setItem.mock.calls.filter(
      (c: string[]) => c[0] === 'draft:disabled-form',
    );
    expect(calls).toHaveLength(0);
  });

  // ── 壊れた JSON の安全なハンドリング ─────────────────

  it('should handle corrupted localStorage data gracefully', () => {
    localStorageMock.setItem('draft:corrupted', 'not valid json{{');

    const { result } = renderHook(() =>
      useAutoSave('corrupted', { x: 1 }),
    );

    expect(result.current.hasDraft).toBe(false);
    expect(result.current.restoreDraft()).toBeNull();
  });

  it('should handle localStorage data with missing fields gracefully', () => {
    localStorageMock.setItem('draft:partial', JSON.stringify({ unrelated: true }));

    const { result } = renderHook(() =>
      useAutoSave('partial', { x: 1 }),
    );

    expect(result.current.hasDraft).toBe(false);
  });
});
