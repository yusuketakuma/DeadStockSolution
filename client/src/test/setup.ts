import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

// Mock window.confirm
vi.stubGlobal('confirm', vi.fn(() => true));

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

// jsdom can return an empty transition-duration, which makes dom-helpers parse NaN.
const originalGetPropertyValue = CSSStyleDeclaration.prototype.getPropertyValue;
CSSStyleDeclaration.prototype.getPropertyValue = function patchedGetPropertyValue(property: string): string {
  const value = originalGetPropertyValue.call(this, property);
  if (property === 'transition-duration') {
    const normalized = value.trim();
    if (!normalized || Number.isNaN(parseFloat(normalized))) {
      return '0s';
    }
  }
  return value;
};

const originalSetTimeout = globalThis.setTimeout.bind(globalThis);
vi.stubGlobal('setTimeout', ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
  const delay = Number(timeout);
  const safeDelay = Number.isFinite(delay) ? delay : 0;
  return originalSetTimeout(handler, safeDelay, ...args);
}) as typeof setTimeout);
