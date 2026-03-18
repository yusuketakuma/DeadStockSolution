import { render, act } from '@testing-library/react';
import React, { forwardRef, useImperativeHandle } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';

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
  constructor(init: { identifier: number; target: EventTarget; clientY: number }) {
    this.identifier = init.identifier;
    this.target = init.target;
    this.clientX = 0;
    this.clientY = init.clientY;
    this.pageX = 0;
    this.pageY = init.clientY;
  }
}

function createTouchEvent(type: string, target: EventTarget, clientY: number): Event {
  const touch = new MockTouch({ identifier: 0, target, clientY });
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', {
    value: type === 'touchend' ? [] : [touch],
  });
  Object.defineProperty(event, 'changedTouches', { value: [touch] });
  event.preventDefault = vi.fn();
  return event;
}

function mockMatchMedia(matches: Record<string, boolean>) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: matches[query] ?? false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

// ─── Test wrapper ──────────────────────────────

interface HookState {
  state: string;
  pullDistance: number;
}

const TestHarness = forwardRef<
  { get: () => HookState },
  { onRefresh: () => Promise<void>; threshold?: number; disabled?: boolean }
>(function TestHarness({ onRefresh, threshold, disabled }, ref) {
  const hook = usePullToRefresh({ onRefresh, threshold, disabled });
  useImperativeHandle(ref, () => ({
    get: () => ({ state: hook.state, pullDistance: hook.pullDistance }),
  }));
  return React.createElement('div', {
    ref: hook.containerRef,
    'data-testid': 'ptr-container',
  });
});

// ────────────────────────────────────────────────
// Touch coordinate convention:
//   clientY increases downward on screen.
//   Pull-to-refresh = finger moves DOWN = clientY increases.
//   touchstart(200) → touchmove(250) = 50px pull down.
// ────────────────────────────────────────────────

describe('usePullToRefresh', () => {
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

    mockMatchMedia({
      '(max-width: 991.98px)': true,
      '(prefers-reduced-motion: reduce)': false,
    });
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
    onRefresh: () => Promise<void>;
    threshold?: number;
    disabled?: boolean;
  }) {
    const hookRef = React.createRef<{ get: () => HookState }>();
    const utils = render(
      React.createElement(TestHarness, { ...props, ref: hookRef }),
    );
    const container = utils.getByTestId('ptr-container') as HTMLDivElement;
    Object.defineProperty(container, 'scrollTop', {
      value: 0,
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

  it('returns idle state initially', () => {
    const { getResult } = setup({
      onRefresh: vi.fn().mockResolvedValue(undefined),
    });
    expect(getResult().state).toBe('idle');
    expect(getResult().pullDistance).toBe(0);
  });

  it('returns idle on desktop (> 991.98px)', () => {
    mockMatchMedia({
      '(max-width: 991.98px)': false,
      '(prefers-reduced-motion: reduce)': false,
    });
    const { getResult, container } = setup({
      onRefresh: vi.fn().mockResolvedValue(undefined),
    });

    act(() => {
      container.dispatchEvent(createTouchEvent('touchstart', container, 200));
      container.dispatchEvent(createTouchEvent('touchmove', container, 300));
      flushRaf();
    });

    expect(getResult().state).toBe('idle');
    expect(getResult().pullDistance).toBe(0);
  });

  it('does NOT activate when disabled=true', () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { getResult, container } = setup({ onRefresh, disabled: true });

    act(() => {
      container.dispatchEvent(createTouchEvent('touchstart', container, 200));
      container.dispatchEvent(createTouchEvent('touchmove', container, 300));
      flushRaf();
    });

    expect(getResult().state).toBe('idle');
    expect(getResult().pullDistance).toBe(0);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('does NOT activate when scrollTop > 0', () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { getResult, container } = setup({ onRefresh });

    Object.defineProperty(container, 'scrollTop', {
      value: 100,
      writable: true,
      configurable: true,
    });

    act(() => {
      container.dispatchEvent(createTouchEvent('touchstart', container, 200));
      container.dispatchEvent(createTouchEvent('touchmove', container, 300));
      flushRaf();
    });

    expect(getResult().state).toBe('idle');
    expect(getResult().pullDistance).toBe(0);
  });

  it('tracks pullDistance during touchmove at scrollTop=0', () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { getResult, container } = setup({ onRefresh });

    act(() => {
      container.dispatchEvent(createTouchEvent('touchstart', container, 200));
    });
    act(() => {
      container.dispatchEvent(createTouchEvent('touchmove', container, 250));
      flushRaf();
    });

    expect(getResult().pullDistance).toBe(50);
    expect(getResult().state).toBe('pulling');
  });

  it('transitions to refreshing when released past threshold (80px)', () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { getResult, container } = setup({ onRefresh, threshold: 80 });

    act(() => {
      container.dispatchEvent(createTouchEvent('touchstart', container, 200));
    });
    act(() => {
      container.dispatchEvent(createTouchEvent('touchmove', container, 300));
      flushRaf();
    });
    act(() => {
      container.dispatchEvent(createTouchEvent('touchend', container, 300));
    });

    expect(getResult().state).toBe('refreshing');
  });

  it('calls onRefresh callback when threshold exceeded', () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { container } = setup({ onRefresh, threshold: 80 });

    act(() => {
      container.dispatchEvent(createTouchEvent('touchstart', container, 200));
    });
    act(() => {
      container.dispatchEvent(createTouchEvent('touchmove', container, 300));
      flushRaf();
    });
    act(() => {
      container.dispatchEvent(createTouchEvent('touchend', container, 300));
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('transitions idle → pulling → refreshing → complete → idle', async () => {
    let resolveRefresh!: () => void;
    const onRefresh = vi.fn(
      () => new Promise<void>((resolve) => { resolveRefresh = resolve; }),
    );
    const { getResult, container } = setup({ onRefresh, threshold: 80 });

    expect(getResult().state).toBe('idle');

    // pulling (finger moves down 100px)
    act(() => {
      container.dispatchEvent(createTouchEvent('touchstart', container, 200));
    });
    act(() => {
      container.dispatchEvent(createTouchEvent('touchmove', container, 300));
      flushRaf();
    });
    expect(getResult().state).toBe('pulling');

    // refreshing (release past threshold)
    act(() => {
      container.dispatchEvent(createTouchEvent('touchend', container, 300));
    });
    expect(getResult().state).toBe('refreshing');

    // complete (onRefresh resolves)
    await act(async () => {
      resolveRefresh();
    });
    expect(getResult().state).toBe('complete');

    // idle (after 500ms delay)
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(getResult().state).toBe('idle');
  });

  it('cleans up event listeners on unmount', () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { container, unmount } = setup({ onRefresh });

    const removeSpy = vi.spyOn(container, 'removeEventListener');
    unmount();

    const removedTypes = removeSpy.mock.calls.map((c) => c[0]);
    expect(removedTypes).toContain('touchstart');
    expect(removedTypes).toContain('touchmove');
    expect(removedTypes).toContain('touchend');
  });

  it('ignores new touches during refreshing state', async () => {
    let resolveRefresh!: () => void;
    const onRefresh = vi.fn(
      () => new Promise<void>((resolve) => { resolveRefresh = resolve; }),
    );
    const { getResult, container } = setup({ onRefresh, threshold: 80 });

    // Reach refreshing state
    act(() => {
      container.dispatchEvent(createTouchEvent('touchstart', container, 200));
    });
    act(() => {
      container.dispatchEvent(createTouchEvent('touchmove', container, 300));
      flushRaf();
    });
    act(() => {
      container.dispatchEvent(createTouchEvent('touchend', container, 300));
    });
    expect(getResult().state).toBe('refreshing');

    // New touch — should be ignored
    act(() => {
      container.dispatchEvent(createTouchEvent('touchstart', container, 200));
    });
    act(() => {
      container.dispatchEvent(createTouchEvent('touchmove', container, 300));
      flushRaf();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);

    // Cleanup
    await act(async () => { resolveRefresh(); });
    act(() => { vi.advanceTimersByTime(500); });
  });
});
