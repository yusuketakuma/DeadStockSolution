import { useCallback, useRef, useState } from 'react';
import { usePinch, useDrag } from '@use-gesture/react';

export interface UsePinchZoomOptions {
  minScale?: number; // default 1
  maxScale?: number; // default 3
}

export interface UsePinchZoomReturn {
  ref: React.RefObject<HTMLDivElement | null>;
  scale: number;
  position: { x: number; y: number };
  isZoomed: boolean; // scale > 1
  reset: () => void; // reset to scale=1, position=0,0
  bindGestures: () => Record<string, unknown>; // gesture bind props to spread on the element
  handleDoubleClick: () => void; // double-tap toggle: 1x <-> 2x
}

/** ピンチ操作によるズーム・ドラッグを管理するフック */
export function usePinchZoom(options: UsePinchZoomOptions = {}): UsePinchZoomReturn {
  const { minScale = 1, maxScale = 3 } = options;
  const ref = useRef<HTMLDivElement | null>(null);

  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  // ピンチ開始時のスケールを保持
  const scaleAtPinchStart = useRef(1);

  const clampScale = useCallback(
    (s: number) => Math.min(maxScale, Math.max(minScale, s)),
    [minScale, maxScale],
  );

  const reset = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  const handleDoubleClick = useCallback(() => {
    setScale((prev) => {
      if (prev > 1) {
        setPosition({ x: 0, y: 0 });
        return 1;
      }
      return clampScale(2);
    });
  }, [clampScale]);

  const bindPinch = usePinch(
    ({ first, offset: [d], memo }) => {
      if (first) {
        scaleAtPinchStart.current = scale;
        return scale;
      }
      const baseScale = (memo as number) ?? scale;
      const newScale = clampScale(baseScale * (d / 100 + 1));
      setScale(newScale);
      // ズーム解除時はポジションもリセット
      if (newScale <= 1) {
        setPosition({ x: 0, y: 0 });
      }
      return memo;
    },
    {
      scaleBounds: { min: minScale, max: maxScale },
      from: () => [(scale - 1) * 100, 0],
    },
  );

  const bindDrag = useDrag(
    ({ delta: [dx, dy] }) => {
      // ズーム中のみドラッグ可能
      if (scale <= 1) return;
      setPosition((prev) => ({
        x: prev.x + dx,
        y: prev.y + dy,
      }));
    },
    {
      // タッチ操作のみ有効（マウスドラッグは無効にしてスクロールと干渉しない）
      pointer: { touch: true },
    },
  );

  const bindGestures = useCallback((): Record<string, unknown> => {
    return { ...bindPinch(), ...bindDrag() };
  }, [bindPinch, bindDrag]);

  return {
    ref,
    scale,
    position,
    isZoomed: scale > 1,
    reset,
    bindGestures,
    handleDoubleClick,
  };
}
