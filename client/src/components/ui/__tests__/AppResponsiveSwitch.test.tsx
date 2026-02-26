import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AppResponsiveSwitch, { APP_RESPONSIVE_MOBILE_QUERY } from '../AppResponsiveSwitch';

function setMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn((cb: (event: MediaQueryListEvent) => void) => listeners.add(cb)),
      removeListener: vi.fn((cb: (event: MediaQueryListEvent) => void) => listeners.delete(cb)),
      addEventListener: vi.fn((eventName: string, cb: (event: MediaQueryListEvent) => void) => {
        if (eventName === 'change') listeners.add(cb);
      }),
      removeEventListener: vi.fn((eventName: string, cb: (event: MediaQueryListEvent) => void) => {
        if (eventName === 'change') listeners.delete(cb);
      }),
      dispatchEvent: vi.fn(),
    })),
  });

  return {
    emit(nextMatches: boolean) {
      matches = nextMatches;
      listeners.forEach((listener) => listener({ matches: nextMatches } as MediaQueryListEvent));
    },
  };
}

describe('AppResponsiveSwitch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setMatchMedia(false);
  });

  it('renders desktop content when media query does not match', () => {
    render(
      <AppResponsiveSwitch
        desktop={<div>desktop-view</div>}
        mobile={<div>mobile-view</div>}
      />,
    );

    expect(screen.getByText('desktop-view')).toBeInTheDocument();
    expect(screen.queryByText('mobile-view')).not.toBeInTheDocument();
  });

  it('renders only mobile lazy content when media query matches', () => {
    setMatchMedia(true);
    const desktop = vi.fn(() => <div>desktop-view</div>);
    const mobile = vi.fn(() => <div>mobile-view</div>);

    render(
      <AppResponsiveSwitch
        desktop={desktop}
        mobile={mobile}
      />,
    );

    expect(screen.getByText('mobile-view')).toBeInTheDocument();
    expect(screen.queryByText('desktop-view')).not.toBeInTheDocument();
    expect(desktop).not.toHaveBeenCalled();
    expect(mobile).toHaveBeenCalledTimes(1);
    expect(window.matchMedia).toHaveBeenCalledWith(APP_RESPONSIVE_MOBILE_QUERY);
  });

  it('switches content when viewport match state changes', async () => {
    const media = setMatchMedia(false);
    render(
      <AppResponsiveSwitch
        desktop={<div>desktop-view</div>}
        mobile={<div>mobile-view</div>}
      />,
    );

    expect(screen.getByText('desktop-view')).toBeInTheDocument();
    act(() => {
      media.emit(true);
    });
    await waitFor(() => {
      expect(screen.getByText('mobile-view')).toBeInTheDocument();
    });
  });

  it('does not crash when matchMedia listener APIs are unavailable', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        dispatchEvent: vi.fn(),
      })),
    });

    render(
      <AppResponsiveSwitch
        desktop={<div>desktop-view</div>}
        mobile={<div>mobile-view</div>}
      />,
    );

    expect(screen.getByText('desktop-view')).toBeInTheDocument();
  });
});
