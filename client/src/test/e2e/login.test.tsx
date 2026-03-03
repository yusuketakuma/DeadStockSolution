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

interface TestPharmacyPreview {
  id: number;
  name: string;
  email: string;
  prefecture: string;
  password: string;
}

function setMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function mockUnauthFetch(options: { testPharmacies?: TestPharmacyPreview[] } = {}) {
  const { testPharmacies = [] } = options;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/auth/test-pharmacies')) {
      return new Response(JSON.stringify({ accounts: testPharmacies }), {
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
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setMatchMedia(false);
  });

  it('renders the login form with tabs', async () => {
    mockUnauthFetch();
    renderWithProviders(<LoginPage />, { route: '/login' });

    await waitFor(() => {
      expect(screen.getByText('薬局デッドストック交換システム')).toBeInTheDocument();
    });
    expect(document.querySelector('.dl-version-chip')).not.toBeNull();
    // Tab navigation
    expect(screen.getByText('薬局ログイン')).toBeInTheDocument();
    expect(screen.getByText('管理者ログイン')).toBeInTheDocument();
    // Default tab is user login
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('ログイン');
    expect(screen.getByText('メールアドレス')).toBeInTheDocument();
    expect(screen.getByText('パスワード')).toBeInTheDocument();
    expect(getInputByLabel('メールアドレス')).toHaveAttribute('type', 'email');
    expect(getInputByLabel('パスワード')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'ログイン' })).toBeInTheDocument();
    expect(screen.getByText('新規登録はこちら')).toBeInTheDocument();
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
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('管理者ログイン');
    });
    // Admin tab shows admin login submit button
    const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submitBtn).toBeTruthy();
    expect(submitBtn.textContent).toBe('管理者ログイン');
    // Register link should NOT be visible in admin mode
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

  it('renders login page key sections', async () => {
    mockUnauthFetch();
    renderWithProviders(<LoginPage />, { route: '/login' });

    await waitFor(() => {
      expect(screen.getByText('薬局デッドストック交換システム')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'ログイン' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ログイン' })).toBeInTheDocument();
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

  it('opens test pharmacy window and applies selected account in desktop view', async () => {
    const user = userEvent.setup();
    mockUnauthFetch({
      testPharmacies: [
        {
          id: 1,
          name: 'テスト薬局東京店',
          email: 'test-tokyo@example.com',
          prefecture: '東京都',
          password: 'TokyoDemo!2026',
        },
        {
          id: 2,
          name: 'テスト薬局札幌店',
          email: 'test-sapporo@example.com',
          prefecture: '北海道',
          password: 'SapporoDemo!2026',
        },
      ],
    });
    renderWithProviders(<LoginPage />, { route: '/login' });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '登録済みテスト薬局を表示' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: '登録済みテスト薬局を表示' }));

    await waitFor(() => {
      expect(screen.getByText('登録済みテスト薬局')).toBeInTheDocument();
    });
    expect(screen.getByText('テスト薬局東京店')).toBeInTheDocument();
    expect(screen.getByText('テスト薬局札幌店')).toBeInTheDocument();
    expect(screen.queryByText('TokyoDemo!2026')).not.toBeInTheDocument();
    expect(screen.queryByText('SapporoDemo!2026')).not.toBeInTheDocument();
    expect(document.querySelector('.dl-test-pharmacy-modal table')).not.toBeNull();
    expect(document.querySelector('.dl-mobile-data-card')).toBeNull();

    const applyButtons = screen.getAllByRole('button', { name: 'このアカウントを入力' });
    await user.click(applyButtons[0]);

    expect(getInputByLabel('メールアドレス')).toHaveValue('test-tokyo@example.com');
    expect(getInputByLabel('パスワード')).toHaveValue('TokyoDemo!2026');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('ログイン');
  });

  it('renders same selection feature in mobile view', async () => {
    const user = userEvent.setup();
    setMatchMedia(true);
    mockUnauthFetch({
      testPharmacies: [
        {
          id: 11,
          name: 'テスト薬局モバイルA',
          email: 'mobile-a@example.com',
          prefecture: '愛知県',
          password: 'MobileA!2026',
        },
        {
          id: 12,
          name: 'テスト薬局モバイルB',
          email: 'mobile-b@example.com',
          prefecture: '福岡県',
          password: 'MobileB!2026',
        },
      ],
    });
    renderWithProviders(<LoginPage />, { route: '/login' });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '登録済みテスト薬局を表示' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: '登録済みテスト薬局を表示' }));

    await waitFor(() => {
      expect(screen.getByText('テスト薬局モバイルA')).toBeInTheDocument();
      expect(screen.getByText('テスト薬局モバイルB')).toBeInTheDocument();
    });
    expect(screen.queryByText('MobileA!2026')).not.toBeInTheDocument();
    expect(screen.queryByText('MobileB!2026')).not.toBeInTheDocument();
    expect(document.querySelector('.dl-mobile-data-card')).not.toBeNull();
    expect(document.querySelector('.dl-test-pharmacy-modal table')).toBeNull();

    const applyButtons = screen.getAllByRole('button', { name: 'このアカウントを入力' });
    await user.click(applyButtons[1]);

    expect(getInputByLabel('メールアドレス')).toHaveValue('mobile-b@example.com');
    expect(getInputByLabel('パスワード')).toHaveValue('MobileB!2026');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('ログイン');
  });

  it('displays footer operation note', async () => {
    mockUnauthFetch();
    renderWithProviders(<LoginPage />, { route: '/login' });

    await waitFor(() => {
      expect(screen.getByText(/本システムは業務補助ツールです/)).toBeInTheDocument();
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
