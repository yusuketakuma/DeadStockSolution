import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ToastProvider, useToast, useToastData } from './ToastContext';
import type { ReactNode } from 'react';

function wrapper({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

function useBothContexts() {
  const actions = useToast();
  const data = useToastData();
  return { ...actions, ...data };
}

describe('ToastContext', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should start with empty toasts', () => {
    const { result } = renderHook(() => useBothContexts(), { wrapper });
    expect(result.current.toasts).toEqual([]);
  });

  it('should add a success toast with autoDismissMs=3000', () => {
    const { result } = renderHook(() => useBothContexts(), { wrapper });
    act(() => result.current.showSuccess('保存しました'));
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].variant).toBe('success');
    expect(result.current.toasts[0].message).toBe('保存しました');
    expect(result.current.toasts[0].autoDismissMs).toBe(3000);
  });

  it('should add an error toast with autoDismissMs=null', () => {
    const { result } = renderHook(() => useBothContexts(), { wrapper });
    act(() => result.current.showError('エラーが発生しました'));
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].variant).toBe('danger');
    expect(result.current.toasts[0].autoDismissMs).toBeNull();
  });

  it('should add warning and info toasts with auto-dismiss', () => {
    const { result } = renderHook(() => useBothContexts(), { wrapper });
    act(() => {
      result.current.showWarning('注意');
      result.current.showInfo('お知らせ');
    });
    expect(result.current.toasts).toHaveLength(2);
    expect(result.current.toasts[0].variant).toBe('warning');
    expect(result.current.toasts[0].autoDismissMs).toBe(3000);
    expect(result.current.toasts[1].variant).toBe('info');
    expect(result.current.toasts[1].autoDismissMs).toBe(3000);
  });

  it('should remove a toast by id', () => {
    const { result } = renderHook(() => useBothContexts(), { wrapper });
    act(() => result.current.showSuccess('テスト'));
    const id = result.current.toasts[0].id;
    act(() => result.current.removeToast(id));
    expect(result.current.toasts).toHaveLength(0);
  });

  it('should cap at 5 toasts, removing oldest', () => {
    const { result } = renderHook(() => useBothContexts(), { wrapper });
    act(() => {
      for (let i = 0; i < 7; i++) {
        result.current.showInfo(`メッセージ${i}`);
      }
    });
    expect(result.current.toasts).toHaveLength(5);
    expect(result.current.toasts[0].message).toBe('メッセージ2');
    expect(result.current.toasts[4].message).toBe('メッセージ6');
  });
});
