import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePinchZoom } from '../../hooks/usePinchZoom';

describe('usePinchZoom', () => {
  it('初期状態で scale=1 を返す', () => {
    const { result } = renderHook(() => usePinchZoom());
    expect(result.current.scale).toBe(1);
  });

  it('初期状態で isZoomed=false', () => {
    const { result } = renderHook(() => usePinchZoom());
    expect(result.current.isZoomed).toBe(false);
  });

  it('初期状態で position が {x:0, y:0}', () => {
    const { result } = renderHook(() => usePinchZoom());
    expect(result.current.position).toEqual({ x: 0, y: 0 });
  });

  it('ダブルクリックで scale が 2 にトグルする', () => {
    const { result } = renderHook(() => usePinchZoom());

    // 1x → 2x
    act(() => {
      result.current.handleDoubleClick();
    });
    expect(result.current.scale).toBe(2);
    expect(result.current.isZoomed).toBe(true);

    // 2x → 1x
    act(() => {
      result.current.handleDoubleClick();
    });
    expect(result.current.scale).toBe(1);
    expect(result.current.isZoomed).toBe(false);
  });

  it('ダブルクリックで 1x に戻る時 position もリセットされる', () => {
    const { result } = renderHook(() => usePinchZoom());

    // ズームイン
    act(() => {
      result.current.handleDoubleClick();
    });
    expect(result.current.scale).toBe(2);

    // ズームアウト → position リセット
    act(() => {
      result.current.handleDoubleClick();
    });
    expect(result.current.scale).toBe(1);
    expect(result.current.position).toEqual({ x: 0, y: 0 });
  });

  it('reset() で scale=1, position={x:0,y:0} に戻る', () => {
    const { result } = renderHook(() => usePinchZoom());

    // ズームイン
    act(() => {
      result.current.handleDoubleClick();
    });
    expect(result.current.scale).toBe(2);

    // リセット
    act(() => {
      result.current.reset();
    });
    expect(result.current.scale).toBe(1);
    expect(result.current.position).toEqual({ x: 0, y: 0 });
    expect(result.current.isZoomed).toBe(false);
  });

  it('maxScale を超えないようクランプされる', () => {
    const { result } = renderHook(() => usePinchZoom({ maxScale: 1.5 }));

    // ダブルクリックで 2x を要求しても maxScale=1.5 にクランプ
    act(() => {
      result.current.handleDoubleClick();
    });
    expect(result.current.scale).toBe(1.5);
  });

  it('bindGestures がオブジェクトを返す', () => {
    const { result } = renderHook(() => usePinchZoom());
    const gestures = result.current.bindGestures();
    expect(typeof gestures).toBe('object');
    expect(gestures).not.toBeNull();
  });

  it('ref が初期状態で null', () => {
    const { result } = renderHook(() => usePinchZoom());
    expect(result.current.ref.current).toBeNull();
  });

  it('カスタム minScale/maxScale を受け付ける', () => {
    const { result } = renderHook(() => usePinchZoom({ minScale: 0.5, maxScale: 5 }));
    expect(result.current.scale).toBe(1);

    // ダブルクリックで 2x（maxScale=5 以内なのでそのまま）
    act(() => {
      result.current.handleDoubleClick();
    });
    expect(result.current.scale).toBe(2);
  });
});
