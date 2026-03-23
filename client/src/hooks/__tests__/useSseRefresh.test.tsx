import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSseRefresh } from '../useSseRefresh';

class MockEventSource {
  static instances: MockEventSource[] = [];

  public onopen: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  private listeners = new Map<string, Set<() => void>>();

  constructor(
    public readonly url: string,
    public readonly init?: EventSourceInit,
  ) {
    MockEventSource.instances.push(this);
  }

  addEventListener(eventName: string, listener: () => void): void {
    const next = this.listeners.get(eventName) ?? new Set<() => void>();
    next.add(listener);
    this.listeners.set(eventName, next);
  }

  removeEventListener(eventName: string, listener: () => void): void {
    this.listeners.get(eventName)?.delete(listener);
  }

  emit(eventName: string): void {
    if (eventName === 'open') {
      this.onopen?.();
      return;
    }
    if (eventName === 'error') {
      this.onerror?.();
      return;
    }
    for (const listener of this.listeners.get(eventName) ?? []) {
      listener();
    }
  }

  close(): void {}
}

describe('useSseRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses SSE events when EventSource is available', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);

    renderHook(() => useSseRefresh({
      enabled: true,
      streamPath: '/realtime/stream?topics=requests',
      events: ['requests.refresh'],
      onRefresh,
      fallbackIntervalMs: 60_000,
    }));

    const source = MockEventSource.instances[0];
    expect(source.url).toContain('/api/realtime/stream?topics=requests');

    act(() => {
      source.emit('open');
      source.emit('requests.refresh');
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('falls back to polling when EventSource is unavailable', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    renderHook(() => useSseRefresh({
      enabled: true,
      streamPath: '/realtime/stream?topics=timeline',
      events: ['timeline.refresh'],
      onRefresh,
      fallbackIntervalMs: 60_000,
    }));

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('re-enables fallback polling after SSE error', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);

    renderHook(() => useSseRefresh({
      enabled: true,
      streamPath: '/realtime/stream?topics=timeline',
      events: ['timeline.refresh'],
      onRefresh,
      fallbackIntervalMs: 60_000,
    }));

    const source = MockEventSource.instances[0];
    act(() => {
      source.emit('open');
      source.emit('error');
      vi.advanceTimersByTime(60_000);
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
