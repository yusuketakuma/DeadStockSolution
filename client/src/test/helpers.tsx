import React from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { MemoryRouter, type MemoryRouterProps } from 'react-router-dom';
import { AuthProvider } from '../contexts/AuthContext';

interface WrapperOptions {
  route?: string;
  routerProps?: MemoryRouterProps;
}

function createWrapper(options: WrapperOptions = {}) {
  const { route = '/', routerProps } = options;
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <MemoryRouter initialEntries={[route]} {...routerProps}>
        <AuthProvider>
          {children}
        </AuthProvider>
      </MemoryRouter>
    );
  };
}

export function renderWithProviders(
  ui: React.ReactElement,
  options: WrapperOptions & Omit<RenderOptions, 'wrapper'> = {},
) {
  const { route, routerProps, ...renderOptions } = options;
  return render(ui, {
    wrapper: createWrapper({ route, routerProps }),
    ...renderOptions,
  });
}

/** Mock user data for authenticated state */
export const mockUser = {
  id: 1,
  email: 'test@example.com',
  name: 'テスト薬局',
  prefecture: '東京都',
  isAdmin: false,
};

export const mockAdminUser = {
  id: 99,
  email: 'admin@example.com',
  name: '管理者',
  prefecture: '東京都',
  isAdmin: true,
};

/** Setup global fetch mock for authenticated user */
export function mockAuthenticatedFetch(user = mockUser) {
  return setupFetchMock({
    '/api/auth/me': user,
  });
}

/** Setup global fetch mock with custom route handlers */
export function setupFetchMock(routes: Record<string, unknown>) {
  const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();

    for (const [path, responseData] of Object.entries(routes)) {
      if (url.includes(path)) {
        return new Response(JSON.stringify(responseData), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Default: return 401 for unmatched /api routes
    if (url.includes('/api/')) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('', { status: 200 });
  });

  vi.stubGlobal('fetch', mockFetch);
  return mockFetch;
}
