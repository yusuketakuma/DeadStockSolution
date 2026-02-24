import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginPage from '../../pages/LoginPage';
import { renderWithProviders, mockUser } from '../helpers';

/** Find an input field by the label text in the same form group */
function getInputByLabel(labelText: string): HTMLInputElement {
  const labels = document.querySelectorAll('.form-label');
  for (const label of labels) {
    if (label.textContent?.includes(labelText)) {
      const group = label.closest('.mb-3') || label.parentElement;
      const input = group?.querySelector('input, select, textarea');
      if (input) return input as HTMLInputElement;
    }
  }
  throw new Error(`Could not find input for label: ${labelText}`);
}

function mockUnauthFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/auth/me')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }));
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the login form with tabs', async () => {
    mockUnauthFetch();
    renderWithProviders(<LoginPage />, { route: '/login' });

    await waitFor(() => {
      expect(screen.getByText('薬局不動在庫交換システム')).toBeInTheDocument();
    });
    // Tab navigation
    expect(screen.getByText('薬局ログイン')).toBeInTheDocument();
    expect(screen.getByText('管理者ログイン')).toBeInTheDocument();
    // Default tab is user login
    expect(screen.getByRole('heading', { level: 5 })).toHaveTextContent('ログイン');
    expect(screen.getByText('メールアドレス')).toBeInTheDocument();
    expect(screen.getByText('パスワード')).toBeInTheDocument();
    expect(getInputByLabel('メールアドレス')).toHaveAttribute('type', 'email');
    expect(getInputByLabel('パスワード')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'ログイン' })).toBeInTheDocument();
    expect(screen.getByText('新規登録はこちら')).toBeInTheDocument();
  });

  it('renders test account login buttons in user mode', async () => {
    mockUnauthFetch();
    renderWithProviders(<LoginPage />, { route: '/login' });

    await waitFor(() => {
      expect(screen.getByText('テストアカウントでログイン')).toBeInTheDocument();
    });
    expect(screen.getByText('テスト薬局（東京）')).toBeInTheDocument();
    expect(screen.getByText('テスト薬局2号店（大阪）')).toBeInTheDocument();
  });

  it('switches to admin login tab', async () => {
    const user = userEvent.setup();
    mockUnauthFetch();
    renderWithProviders(<LoginPage />, { route: '/login' });

    await waitFor(() => {
      expect(screen.getByText('管理者ログイン')).toBeInTheDocument();
    });

    await user.click(screen.getByText('管理者ログイン'));

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 5 })).toHaveTextContent('管理者ログイン');
    });
    // Admin tab shows admin login submit button
    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submitBtn).toBeTruthy();
    expect(submitBtn.textContent).toBe('管理者ログイン');
    // Test accounts and register link should NOT be visible
    expect(screen.queryByText('テストアカウントでログイン')).not.toBeInTheDocument();
    expect(screen.queryByText('新規登録はこちら')).not.toBeInTheDocument();
    // Admin mode hint
    expect(screen.getByText('管理者アカウントでログインしてください。')).toBeInTheDocument();
  });

  it('shows error message when login fails', async () => {
    const user = userEvent.setup();

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/login')) {
        return new Response(JSON.stringify({ error: 'メールアドレスまたはパスワードが正しくありません' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    renderWithProviders(<LoginPage />, { route: '/login' });

    await waitFor(() => {
      expect(screen.getByText('メールアドレス')).toBeInTheDocument();
    });

    await user.type(getInputByLabel('メールアドレス'), 'wrong@example.com');
    await user.type(getInputByLabel('パスワード'), 'wrongpassword');
    await user.click(screen.getByRole('button', { name: 'ログイン' }));

    await waitFor(() => {
      expect(screen.getByText('メールアドレスまたはパスワードが正しくありません')).toBeInTheDocument();
    });
  });

  it('submits login form with correct credentials', async () => {
    const user = userEvent.setup();

    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/login')) {
        return new Response(JSON.stringify(mockUser), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<LoginPage />, { route: '/login' });

    await waitFor(() => {
      expect(screen.getByText('メールアドレス')).toBeInTheDocument();
    });

    await user.type(getInputByLabel('メールアドレス'), 'test@example.com');
    await user.type(getInputByLabel('パスワード'), 'password123');
    await user.click(screen.getByRole('button', { name: 'ログイン' }));

    await waitFor(() => {
      const loginCall = fetchMock.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('/api/auth/login')
      );
      expect(loginCall).toBeTruthy();
      const body = JSON.parse((loginCall![1] as RequestInit).body as string);
      expect(body.email).toBe('test@example.com');
      expect(body.password).toBe('password123');
    });
  });

  it('handles test account login', async () => {
    const user = userEvent.setup();

    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/login')) {
        return new Response(JSON.stringify(mockUser), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<LoginPage />, { route: '/login' });

    await waitFor(() => {
      expect(screen.getByText('テスト薬局（東京）')).toBeInTheDocument();
    });

    await user.click(screen.getByText('テスト薬局（東京）'));

    await waitFor(() => {
      const loginCall = fetchMock.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('/api/auth/login')
      );
      expect(loginCall).toBeTruthy();
      const body = JSON.parse((loginCall![1] as RequestInit).body as string);
      expect(body.email).toBe('test@example.com');
      expect(body.password).toBe('test1234');
    });
  });

  it('has link to registration page in user mode', async () => {
    mockUnauthFetch();
    renderWithProviders(<LoginPage />, { route: '/login' });

    await waitFor(() => {
      const registerLink = screen.getByText('新規登録はこちら');
      expect(registerLink).toBeInTheDocument();
      expect(registerLink.closest('a')).toHaveAttribute('href', '/register');
    });
  });

  it('displays disclaimer in the card footer', async () => {
    mockUnauthFetch();
    renderWithProviders(<LoginPage />, { route: '/login' });

    await waitFor(() => {
      expect(screen.getByText(/本システムは業務補助ツールであり/)).toBeInTheDocument();
    });
  });

  it('shows error when non-admin tries admin login', async () => {
    const user = userEvent.setup();

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/login')) {
        return new Response(JSON.stringify({ ...mockUser, isAdmin: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    renderWithProviders(<LoginPage />, { route: '/login' });

    await waitFor(() => {
      expect(screen.getByText('管理者ログイン')).toBeInTheDocument();
    });

    // Switch to admin tab
    await user.click(screen.getByText('管理者ログイン'));

    await waitFor(() => {
      const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
      expect(submitBtn).toBeTruthy();
      expect(submitBtn.textContent).toBe('管理者ログイン');
    });

    await user.type(getInputByLabel('メールアドレス'), 'user@example.com');
    await user.type(getInputByLabel('パスワード'), 'password123');
    await user.click(document.querySelector('button[type="submit"]') as HTMLButtonElement);

    await waitFor(() => {
      expect(screen.getByText('管理者権限がありません')).toBeInTheDocument();
    });
  });
});
