import { render, act } from '@testing-library/react';
import React, { forwardRef, useImperativeHandle } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSwipeAction } from '../../hooks/useSwipeAction';

// ─── jsdom Touch polyfill ──────────────────────

class MockTouch implements Touch {
  readonly identifier: number;
  readonly target: EventTarget;
  readonly clientX: number;
  readonly clientY: number;
  readonly screenX = 0;
  readonly screenY = 0;
  readonly pageX: number;
  readonly pageY: number;
  readonly radiusX = 0;
  readonly radiusY = 0;
  readonly rotationAngle = 0;
  readonly force = 0;
  constructor(init: { identifier: number; target: EventTarget; clientX: number; clientY: number }) {
    this.identifier = init.identifier;
    this.target = init.target;
    this.clientX = init.clientX;
    this.clientY = init.clientY;
    this.pageX = init.clientX;
    this.pageY = init.clientY;
  }
}

function createTouchEvent(
  type: string,
  target: EventTarget,
  clientX: number,
  clientY: number = 0,
): Event {
  const touch = new MockTouch({ identifier: 0, target, clientX, clientY });
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', {
    value: type === 'touchend' ? [] : [touch],
  });
  Object.defineProperty(event, 'changedTouches', { value: [touch] });
  event.preventDefault = vi.fn();
  return event;
}

// ─── Test wrapper ──────────────────────────────

interface HookState {
  offset: number;
  isSwiping: boolean;
  direction: 'left' | 'right' | null;
}

const TestHarness = forwardRef<
  { get: () => HookState },
  {
    onSwipeLeft?: () => void;
    onSwipeRight?: () => void;
    threshold?: number;
    disabled?: boolean;
  }
>(function TestHarness({ onSwipeLeft, onSwipeRight, threshold, disabled }, ref) {
  const hook = useSwipeAction({ onSwipeLeft, onSwipeRight, threshold, disabled });
  useImperativeHandle(ref, () => ({
    get: () => ({ offset: hook.offset, isSwiping: hook.isSwiping, direction: hook.direction }),
  }));
  return React.createElement('div', {
    ref: hook.ref,
    'data-testid': 'swipe-container',
  });
});

// ────────────────────────────────────────────────
// Touch coordinate convention:
//   clientX increases rightward on screen.
//   Swipe left = finger moves LEFT = clientX decreases.
//   touchstart(200, 0) → touchmove(100, 0) = 100px swipe left.
// ────────────────────────────────────────────────

describe('useSwipeAction', () => {
  let rafQueue: FrameRequestCallback[];
  let origRAF: typeof requestAnimationFrame;
  let origCAF: typeof cancelAnimationFrame;

  beforeEach(() => {
    vi.useFakeTimers();

    origRAF = globalThis.requestAnimationFrame;
    origCAF = globalThis.cancelAnimationFrame;

    rafQueue = [];
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) => {
      if (id > 0 && id <= rafQueue.length) {
        rafQueue[id - 1] = () => {};
      }
    }) as typeof cancelAnimationFrame;
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = origRAF;
    globalThis.cancelAnimationFrame = origCAF;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function flushRaf() {
    const cbs = rafQueue.splice(0);
    cbs.forEach((cb) => cb(performance.now()));
  }

  function setup(props: {
    onSwipeLeft?: () => void;
    onSwipeRight?: () => void;
    threshold?: number;
    disabled?: boolean;
  } = {}) {
    const hookRef = React.createRef<{ get: () => HookState }>();
    const utils = render(
      React.createElement(TestHarness, { ...props, ref: hookRef }),
    );
    const container = utils.getByTestId('swipe-container') as HTMLDivElement;
    // Mock offsetWidth for threshold calculation (20% of 500 = 100px)
    Object.defineProperty(container, 'offsetWidth', {
      value: 500,
      writable: true,
      configurable: true,
    });
    return {
      ...utils,
      container,
      getResult: () => hookRef.current!.get(),
    };
  }

  // ─── Tests ─────────────────────────────────────

  it('returns initial state (offset=0, isSwiping=false, direction=null)', () => {
    const { getResult } = setup();
    expect(getResult().offset).toBe(0);
    expect(getResult().isSwiping).toBe(false);
    expect(getResult().direction).toBeNull();
  });

  it('does not activate when disabled', () => {
    const onSwipeLeft = vi.fn();
    const { getResult, container } = setup({ onSwipeLeft, disabled: true });

    act(() => {
      container.dispatchEvent(createTouchEvent('touchstart', container, 200, 0));
    });
    act(() => {
      container.dispatchEvent(createTouchEvent('touchmove', container, 50, 0));
      flushRaf();
    });
    act(() => {
      container.dispatchEvent(createTouchEvent('touchend', container, 50, 0));
    });

    expect(getResult().offset).toBe(0);
    expect(getResult().isSwiping).toBe(false);
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it('tracks horizontal offset during touchmove', () => {
    const { getResult, container } = setup();

    act(() => {
      container.dispatchEvent(createTouchEvent('touchstart', container, 200, 0));
    });
    act(() => {
      container.dispatchEvent(createTouchEvent('touchmove', container, 150, 0));
      flushRaf();
    });

    expect(getResult().offset).toBe(-50);
    expect(getResult().isSwiping).toBe(true);
  });

  it('ignores vertical swipes (angle > 30 degrees)', () => {
    const { getResult, container } = setup();

    // Vertical movement dominates: dx=10, dy=50 → angle ~78° from horizontal
    act(() => {
      container.dispatchEvent(createTouchEvent('touchstart', container, 200, 200));
    });
    act(() => {
      container.dispatchEvent(createTouchEvent('touchmove', container, 190, 250));
      flushRaf();
    });

    expect(getResult().offset).toBe(0);
    expect(getResult().isSwiping).toBe(false);
  });

  it('calls onSwipeLeft when swiped left past threshold', () => {
    const onSwipeLeft = vi.fn();
    // offsetWidth = 500, 20% = 100px threshold
    const { container } = setup({ onSwipeLeft });

    act(() => {
      container.dispatchEvent(createTouchEvent('touchstart', container, 300, 0));
    });
    act(() => {
      container.dispatchEvent(createTouchEvent('touchmove', container, 180, 0));
      flushRaf();
    });
    act(() => {
      container.dispatchEvent(createTouchEvent('touchend', container, 180, 0));
    });

    expect(onSwipeLeft).toHaveBeenCalledTimes(1);
  });

  it('calls onSwipeRight when swiped right past threshold', () => {
    const onSwipeRight = vi.fn();
    const { container } = setup({ onSwipeRight });

    act(() => {
      container.dispatchEvent(createTouchEvent('touchstart', container, 100, 0));
    });
    act(() => {
      container.dispatchEvent(createTouchEvent('touchmove', container, 220, 0));
      flushRaf();
    });
    act(() => {
      container.dispatchEvent(createTouchEvent('touchend', container, 220, 0));
    });

    expect(onSwipeRight).toHaveBeenCalledTimes(1);
  });

  it('snaps back when released below threshold', () => {
    const onSwipeLeft = vi.fn();
    const { getResult, container } = setup({ onSwipeLeft });

    act(() => {
      container.dispatchEvent(createTouchEvent('touchstart', container, 200, 0));
    });
    act(() => {
      // Move only 30px (below 100px threshold for 500px wide element)
      container.dispatchEvent(createTouchEvent('touchmove', container, 170, 0));
      flushRaf();
    });
    act(() => {
      container.dispatchEvent(createTouchEvent('touchend', container, 170, 0));
    });

    expect(onSwipeLeft).not.toHaveBeenCalled();
    expect(getResult().offset).toBe(0);
  });

  it('sets direction correctly (left or right)', () => {
    const { getResult, container } = setup();

    // Swipe left
    act(() => {
      container.dispatchEvent(createTouchEvent('touchstart', container, 200, 0));
    });
    act(() => {
      container.dispatchEvent(createTouchEvent('touchmove', container, 150, 0));
      flushRaf();
    });
    expect(getResult().direction).toBe('left');

    // End the gesture
    act(() => {
      container.dispatchEvent(createTouchEvent('touchend', container, 150, 0));
    });

    // Swipe right
    act(() => {
      container.dispatchEvent(createTouchEvent('touchstart', container, 100, 0));
    });
    act(() => {
      container.dispatchEvent(createTouchEvent('touchmove', container, 150, 0));
      flushRaf();
    });
    expect(getResult().direction).toBe('right');
  });

  it('cleans up listeners on unmount', () => {
    const { container, unmount } = setup();

    const removeSpy = vi.spyOn(container, 'removeEventListener');
    unmount();

    const removedTypes = removeSpy.mock.calls.map((c) => c[0]);
    expect(removedTypes).toContain('touchstart');
    expect(removedTypes).toContain('touchmove');
    expect(removedTypes).toContain('touchend');
  });
});
