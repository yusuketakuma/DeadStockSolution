import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginPage from '../../pages/LoginPage';
import { renderWithProviders, mockUser } from '../helpers';

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
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
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
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    setMatchMedia(false);
  });

  it('renders a simple login screen', async () => {
    mockUnauthFetch();
    renderWithProviders(<LoginPage />, { route: '/login' });

    await waitFor(() => {
      expect(screen.getByText('薬局デッドストック交換システム')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: '通常ログイン' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '管理者ログイン' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'ログイン' })).toBeInTheDocument();
    expect(screen.getByText('新規登録はこちら')).toBeInTheDocument();
    expect(screen.getByText('開発者ログイン')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '一覧から選ぶ' })).toBeInTheDocument();
  });

  it('switches to admin login mode', async () => {
    const user = userEvent.setup();
    mockUnauthFetch();
    renderWithProviders(<LoginPage />, { route: '/login' });

    await user.click(screen.getByRole('button', { name: '管理者ログイン' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: '管理者ログイン' })).toBeInTheDocument();
    });
    expect(screen.queryByText('開発者ログイン')).not.toBeInTheDocument();
    expect(screen.queryByText('新規登録はこちら')).not.toBeInTheDocument();
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

    await user.type(getInputByLabel('メールアドレス'), 'wrong@example.com');
    await user.type(getInputByLabel('パスワード'), 'wrongpassword');
    await user.click(screen.getByRole('button', { name: 'ログイン' }));

    await waitFor(() => {
      expect(screen.getByText('メールアドレスまたはパスワードが正しくありません')).toBeInTheDocument();
    });
  });

  it('submits login form with correct credentials', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
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

    await user.type(getInputByLabel('メールアドレス'), 'test@example.com');
    await user.type(getInputByLabel('パスワード'), 'password123');
    await user.click(screen.getByRole('button', { name: 'ログイン' }));

    await waitFor(() => {
      const loginCall = fetchMock.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('/api/auth/login'),
      ) as [RequestInfo | URL, RequestInit?] | undefined;
      expect(loginCall).toBeTruthy();
      const body = JSON.parse(loginCall?.[1]?.body as string);
      expect(body.email).toBe('test@example.com');
      expect(body.password).toBe('password123');
    });
  });

  it('hides developer login shortcuts when feature flag is disabled', async () => {
    vi.stubEnv('VITE_TEST_LOGIN_FEATURE_ENABLED', 'false');
    mockUnauthFetch();
    renderWithProviders(<LoginPage />, { route: '/login' });

    await waitFor(() => {
      expect(screen.getByText('薬局デッドストック交換システム')).toBeInTheDocument();
    });

    expect(screen.queryByText('開発者ログイン')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '一覧から選ぶ' })).not.toBeInTheDocument();
  });

  it('opens developer login modal and applies selected account in desktop view', async () => {
    const user = userEvent.setup();
    const fetchMock = mockUnauthFetch({
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

    await user.click(screen.getByRole('button', { name: '一覧から選ぶ' }));

    await waitFor(() => {
      expect(screen.getAllByText('開発者ログイン').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('テスト薬局東京店')).toBeInTheDocument();
    expect(screen.getByText('テスト薬局札幌店')).toBeInTheDocument();
    expect(screen.getByText('TokyoDemo!2026')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes('/api/auth/test-pharmacies?includePassword=1')),
    ).toBe(true);

    const applyButtons = screen.getAllByRole('button', { name: 'このID/パスワードを入力' });
    await user.click(applyButtons[0]);

    expect(getInputByLabel('メールアドレス')).toHaveValue('test-tokyo@example.com');
    expect(getInputByLabel('パスワード')).toHaveValue('TokyoDemo!2026');
  });

  it('renders developer login modal list in mobile view', async () => {
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
      ],
    });
    renderWithProviders(<LoginPage />, { route: '/login' });

    await user.click(screen.getByRole('button', { name: '一覧から選ぶ' }));

    await waitFor(() => {
      expect(screen.getByText('テスト薬局モバイルA')).toBeInTheDocument();
      expect(screen.getByText('MobileA!2026')).toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: '管理者ログイン' }));
    await user.type(getInputByLabel('メールアドレス'), 'user@example.com');
    await user.type(getInputByLabel('パスワード'), 'password123');
    await user.click(document.querySelector('button[type="submit"]') as HTMLButtonElement);

    await waitFor(() => {
      expect(screen.getByText('管理者権限がありません')).toBeInTheDocument();
    });
  });
});
