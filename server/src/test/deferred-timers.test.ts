import { describe, expect, it, vi } from 'vitest';
import { createDeferredTimerRegistry, DeferredTimerHandle } from '../utils/deferred-timers';

function createClock(start = 0) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe('createDeferredTimerRegistry', () => {
  it('runs an interval each time it is due and reschedules from the run time', () => {
    const clock = createClock();
    const registry = createDeferredTimerRegistry(clock.now);
    const callback = vi.fn();
    registry.setInterval(callback, 1000, 'arg');

    expect(registry.runDue()).toBe(0);
    clock.advance(999);
    expect(registry.runDue()).toBe(0);
    clock.advance(1);
    expect(registry.runDue()).toBe(1);
    expect(callback).toHaveBeenCalledWith('arg');

    clock.advance(500);
    expect(registry.runDue()).toBe(0);
    clock.advance(500);
    expect(registry.runDue()).toBe(1);
    expect(callback).toHaveBeenCalledTimes(2);
    expect(registry.size).toBe(1);
  });

  it('runs a timeout once and then forgets it', () => {
    const clock = createClock();
    const registry = createDeferredTimerRegistry(clock.now);
    const callback = vi.fn();
    registry.setTimeout(callback, 10);

    clock.advance(10);
    expect(registry.runDue()).toBe(1);
    clock.advance(10);
    expect(registry.runDue()).toBe(0);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
  });

  it('clears registered timers and ignores foreign handles', () => {
    const registry = createDeferredTimerRegistry(() => 0);
    const callback = vi.fn();
    const handle = registry.setInterval(callback, 0);

    expect(registry.clear({})).toBe(false);
    expect(registry.clear(handle)).toBe(true);
    expect(registry.runDue(100)).toBe(0);
    expect(callback).not.toHaveBeenCalled();
  });

  it('treats invalid delays as zero and non-function callbacks as no-ops', () => {
    const registry = createDeferredTimerRegistry(() => 0);
    const callback = vi.fn();
    registry.setInterval(callback, 'not-a-number');
    registry.setTimeout(callback, -5);
    const noop = registry.setTimeout('code string', 0);

    expect(noop).toBeInstanceOf(DeferredTimerHandle);
    expect(registry.size).toBe(2);
    expect(registry.runDue(0)).toBe(2);
  });

  it('returns Node-compatible timer handles', () => {
    const handle = createDeferredTimerRegistry().setInterval(() => undefined, 1000);
    expect(handle.unref()).toBe(handle);
    expect(handle.ref()).toBe(handle);
    expect(handle.refresh()).toBe(handle);
    expect(handle.close()).toBe(handle);
    expect(handle.hasRef()).toBe(false);
    expect(Number(handle)).toBe(0);
  });
});
