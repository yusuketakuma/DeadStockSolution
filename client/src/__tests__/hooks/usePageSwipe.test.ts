import { renderHook } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { usePageSwipe } from '../../hooks/usePageSwipe';

// ─── Mock react-router-dom navigate ──────────────
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// ─── Mock matchMedia ─────────────────────────────
function createMatchMedia(matches: boolean) {
  return (query: string): MediaQueryList => ({
    matches: query.includes('max-width') ? matches : false, // reduced-motion returns false
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });
}

// ─── Touch event helpers ─────────────────────────

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
  clientY: number = 100,
): Event {
  const touch = new MockTouch({ identifier: 0, target, clientX, clientY });
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', {
    value: type === 'touchend' ? [] : [touch],
  });
  Object.defineProperty(event, 'changedTouches', { value: [touch] });
  return event;
}

// ─── Test helpers ────────────────────────────────

function renderPageSwipe(
  options: { pathname?: string; disabled?: boolean } = {},
) {
  const { pathname = '/', disabled } = options;
  const container = document.createElement('div');
  document.body.appendChild(container);

  // Mock innerWidth for edge detection
  Object.defineProperty(window, 'innerWidth', { value: 400, writable: true, configurable: true });

  const ref = { current: container } as React.RefObject<HTMLElement>;

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(MemoryRouter, { initialEntries: [pathname] }, children);

  const result = renderHook(() => usePageSwipe(ref, { disabled }), { wrapper });

  return { container, ref, ...result };
}

// ─── Tests ───────────────────────────────────────

describe('usePageSwipe', () => {
  let origMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    mockNavigate.mockClear();
    origMatchMedia = window.matchMedia;
    // Default: mobile viewport
    window.matchMedia = createMatchMedia(true);
  });

  afterEach(() => {
    window.matchMedia = origMatchMedia;
    // Clean up any appended containers
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('does not activate on desktop', () => {
    // Desktop: matchMedia returns false for max-width
    window.matchMedia = createMatchMedia(false);

    const { container } = renderPageSwipe({ pathname: '/' });

    container.dispatchEvent(createTouchEvent('touchstart', container, 200));
    container.dispatchEvent(createTouchEvent('touchmove', container, 50));
    container.dispatchEvent(createTouchEvent('touchend', container, 50));

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not activate when disabled', () => {
    const { container } = renderPageSwipe({ pathname: '/', disabled: true });

    container.dispatchEvent(createTouchEvent('touchstart', container, 200));
    container.dispatchEvent(createTouchEvent('touchmove', container, 50));
    container.dispatchEvent(createTouchEvent('touchend', container, 50));

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('ignores touches near screen edges (< 20px)', () => {
    const { container } = renderPageSwipe({ pathname: '/' });

    // Near left edge (clientX = 10)
    container.dispatchEvent(createTouchEvent('touchstart', container, 10));
    container.dispatchEvent(createTouchEvent('touchmove', container, -120));
    container.dispatchEvent(createTouchEvent('touchend', container, -120));

    expect(mockNavigate).not.toHaveBeenCalled();

    // Near right edge (clientX = 395, window.innerWidth = 400)
    container.dispatchEvent(createTouchEvent('touchstart', container, 395));
    container.dispatchEvent(createTouchEvent('touchmove', container, 250));
    container.dispatchEvent(createTouchEvent('touchend', container, 250));

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('ignores touches when input is focused', () => {
    const { container } = renderPageSwipe({ pathname: '/' });

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    container.dispatchEvent(createTouchEvent('touchstart', container, 200));
    container.dispatchEvent(createTouchEvent('touchmove', container, 50));
    container.dispatchEvent(createTouchEvent('touchend', container, 50));

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('navigates to next tab on left swipe past threshold', () => {
    // Start at '/' (index 0), swipe left → '/matching' (index 1)
    const { container } = renderPageSwipe({ pathname: '/' });

    container.dispatchEvent(createTouchEvent('touchstart', container, 300));
    container.dispatchEvent(createTouchEvent('touchmove', container, 150));
    container.dispatchEvent(createTouchEvent('touchend', container, 150));

    expect(mockNavigate).toHaveBeenCalledWith('/matching');
  });

  it('navigates to previous tab on right swipe', () => {
    // Start at '/matching' (index 1), swipe right → '/' (index 0)
    const { container } = renderPageSwipe({ pathname: '/matching' });

    container.dispatchEvent(createTouchEvent('touchstart', container, 100));
    container.dispatchEvent(createTouchEvent('touchmove', container, 250));
    container.dispatchEvent(createTouchEvent('touchend', container, 250));

    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('does not navigate beyond first tab', () => {
    // At '/' (index 0), swipe right → nothing
    const { container } = renderPageSwipe({ pathname: '/' });

    container.dispatchEvent(createTouchEvent('touchstart', container, 100));
    container.dispatchEvent(createTouchEvent('touchmove', container, 250));
    container.dispatchEvent(createTouchEvent('touchend', container, 250));

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not navigate beyond last tab', () => {
    // At '/alerts' (last tab), swipe left → nothing
    const { container } = renderPageSwipe({ pathname: '/alerts' });

    container.dispatchEvent(createTouchEvent('touchstart', container, 300));
    container.dispatchEvent(createTouchEvent('touchmove', container, 150));
    container.dispatchEvent(createTouchEvent('touchend', container, 150));

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('uses admin mobile nav order on admin routes', () => {
    const { container } = renderPageSwipe({ pathname: '/admin' });

    container.dispatchEvent(createTouchEvent('touchstart', container, 300));
    container.dispatchEvent(createTouchEvent('touchmove', container, 150));
    container.dispatchEvent(createTouchEvent('touchend', container, 150));

    expect(mockNavigate).toHaveBeenCalledWith('/admin/user-requests');
  });

  it('resolves alias routes to the closest mobile tab', () => {
    const { container } = renderPageSwipe({ pathname: '/notifications' });

    container.dispatchEvent(createTouchEvent('touchstart', container, 100));
    container.dispatchEvent(createTouchEvent('touchmove', container, 250));
    container.dispatchEvent(createTouchEvent('touchend', container, 250));

    expect(mockNavigate).toHaveBeenCalledWith('/messages');
  });

  it('treats groups routes as part of the home tab when swiping', () => {
    const { container } = renderPageSwipe({ pathname: '/groups' });

    container.dispatchEvent(createTouchEvent('touchstart', container, 300));
    container.dispatchEvent(createTouchEvent('touchmove', container, 150));
    container.dispatchEvent(createTouchEvent('touchend', container, 150));

    expect(mockNavigate).toHaveBeenCalledWith('/matching');
  });

  it('cleans up listeners on unmount', () => {
    const { container, unmount } = renderPageSwipe({ pathname: '/' });

    const removeSpy = vi.spyOn(container, 'removeEventListener');
    unmount();

    const removedTypes = removeSpy.mock.calls.map((c) => c[0]);
    expect(removedTypes).toContain('touchstart');
    expect(removedTypes).toContain('touchmove');
    expect(removedTypes).toContain('touchend');
  });
});
