import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Keep in sync with useCamera.ts ZXING_RSS_WARNING
const ZXING_RSS_WARNING = 'RSS Expanded reader IS NOT ready for production yet! use at your own risk.';
const originalConsoleWarn = console.warn.bind(console);
vi.spyOn(console, 'warn').mockImplementation((message?: unknown, ...args: unknown[]) => {
  if (message === ZXING_RSS_WARNING) {
    return;
  }
  originalConsoleWarn(message, ...args);
});

afterEach(() => {
  cleanup();
});

// Mock window.confirm
vi.stubGlobal('confirm', vi.fn(() => true));

// Ensure localStorage works in jsdom (Node 22+ built-in localStorage can conflict)
if (typeof window.localStorage === 'undefined' || typeof window.localStorage.getItem !== 'function') {
  const store = new Map<string, string>();
  const storageMock: Storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (index: number) => [...store.keys()][index] ?? null,
  };
  Object.defineProperty(window, 'localStorage', { value: storageMock, writable: true });
}

afterEach(() => {
  try { window.localStorage.clear(); } catch { /* ignore */ }
});

// Mock window.matchMedia (required by react-bootstrap Offcanvas)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

if (typeof HTMLCanvasElement !== 'undefined') {
  const defaultCanvasContext = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
    putImageData: vi.fn(),
    createImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
    setTransform: vi.fn(),
    resetTransform: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
  };

  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    writable: true,
    value: vi.fn(() => defaultCanvasContext),
  });
}

// jsdom can return an empty transition-duration, which makes dom-helpers parse NaN.
const originalGetPropertyValue = CSSStyleDeclaration.prototype.getPropertyValue;
CSSStyleDeclaration.prototype.getPropertyValue = function patchedGetPropertyValue(property: string): string {
  const value = originalGetPropertyValue.call(this, property);
  if (property === 'transition-duration' || property === 'transition-delay') {
    const normalized = value.trim();
    if (!normalized || Number.isNaN(parseFloat(normalized))) {
      return '0s';
    }
  }
  return value;
};

const originalGetComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = ((element: Element) => {
  const styles = originalGetComputedStyle(element);
  const originalComputedGetPropertyValue = styles.getPropertyValue.bind(styles);
  styles.getPropertyValue = (property: string) => {
    const value = originalComputedGetPropertyValue(property);
    if (property === 'transition-duration' || property === 'transition-delay') {
      const normalized = value.trim();
      if (!normalized || Number.isNaN(parseFloat(normalized))) {
        return '0s';
      }
    }
    return value;
  };
  return styles;
}) as typeof window.getComputedStyle;

const originalSetTimeout = globalThis.setTimeout.bind(globalThis);
vi.stubGlobal('setTimeout', ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
  const delay = Number(timeout);
  const safeDelay = Number.isFinite(delay) ? delay : 0;
  return originalSetTimeout(handler, safeDelay, ...args);
}) as typeof setTimeout);
