import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../../contexts/AuthContext';
import { api } from '../../api/client';

// APIクライアントをモック
vi.mock('../../api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
  setAuthExpiredHandler: vi.fn(),
}));

const mockApi = vi.mocked(api);
const mockSetAuthExpiredHandler = vi.mocked(
  await import('../../api/client').then((m) => m.setAuthExpiredHandler)
);

// テスト用コンポーネント
function TestConsumer() {
  const { user, loading, login, logout, refreshUser } = useAuth();
  return (
    <div>
      <span data-testid="loading">{loading.toString()}</span>
      <span data-testid="user">{user ? JSON.stringify(user) : 'null'}</span>
      <button data-testid="login" onClick={() => login('test@example.com', 'password')}>
        Login
      </button>
      <button data-testid="logout" onClick={() => logout()}>
        Logout
      </button>
      <button data-testid="refresh" onClick={() => refreshUser()}>
        Refresh
      </button>
    </div>
  );
}

function renderAuthContext() {
  return render(
    <AuthProvider>
      <TestConsumer />
    </AuthProvider>
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.get.mockReset();
    mockApi.post.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('初期状態', () => {
    it('初期ローディング状態がtrueで始まる', async () => {
      mockApi.get.mockImplementation(() => new Promise(() => {})); // 永続的なペンディング

      renderAuthContext();

      expect(screen.getByTestId('loading').textContent).toBe('true');
    });

    it('未認証ユーザーでuserがnull', async () => {
      mockApi.get.mockRejectedValue(new Error('Unauthorized'));

      renderAuthContext();

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('false');
      });

      expect(screen.getByTestId('user').textContent).toBe('null');
    });

    it('認証済みユーザーでuserが設定される', async () => {
      const mockUser = {
        id: 1,
        email: 'test@example.com',
        name: 'テスト薬局',
        prefecture: '東京都',
        isAdmin: false,
      };
      mockApi.get.mockResolvedValue(mockUser);

      renderAuthContext();

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('false');
      });

      const userText = screen.getByTestId('user').textContent;
      expect(userText).not.toBe('null');
      const parsedUser = JSON.parse(userText!);
      expect(parsedUser.email).toBe('test@example.com');
    });
  });

  describe('login', () => {
    it('ログイン成功でuserが設定される', async () => {
      const mockUser = {
        id: 1,
        email: 'test@example.com',
        name: 'テスト薬局',
        prefecture: '東京都',
        isAdmin: false,
      };
      mockApi.get.mockRejectedValue(new Error('Unauthorized'));
      mockApi.post.mockResolvedValue(mockUser);

      renderAuthContext();

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('false');
      });

      screen.getByTestId('login').click();

      await waitFor(() => {
        const userText = screen.getByTestId('user').textContent;
        expect(userText).not.toBe('null');
      });

      expect(mockApi.post).toHaveBeenCalledWith('/auth/login', {
        email: 'test@example.com',
        password: 'password',
      });
    });

    it('ログイン失敗でuserはnullのまま', async () => {
      mockApi.get.mockRejectedValue(new Error('Unauthorized'));
      mockApi.post.mockRejectedValue(new Error('Invalid credentials'));

      renderAuthContext();

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('false');
      });

      // ログイン失敗時はuserがnullのまま
      expect(screen.getByTestId('user').textContent).toBe('null');
    });
  });

  describe('logout', () => {
    it('ログアウトでuserがnullになる', async () => {
      const mockUser = {
        id: 1,
        email: 'test@example.com',
        name: 'テスト薬局',
        prefecture: '東京都',
        isAdmin: false,
      };
      mockApi.get.mockResolvedValue(mockUser);
      mockApi.post.mockResolvedValue(undefined);

      renderAuthContext();

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('false');
      });

      // ログイン済みを確認
      expect(screen.getByTestId('user').textContent).not.toBe('null');

      screen.getByTestId('logout').click();

      await waitFor(() => {
        expect(screen.getByTestId('user').textContent).toBe('null');
      });

      expect(mockApi.post).toHaveBeenCalledWith('/auth/logout');
    });

    it('ログアウトAPI失敗でもuserはnullになる', async () => {
      const mockUser = {
        id: 1,
        email: 'test@example.com',
        name: 'テスト薬局',
        prefecture: '東京都',
        isAdmin: false,
      };
      mockApi.get.mockResolvedValue(mockUser);
      mockApi.post.mockRejectedValue(new Error('Network error'));

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      renderAuthContext();

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('false');
      });

      screen.getByTestId('logout').click();

      await waitFor(() => {
        expect(screen.getByTestId('user').textContent).toBe('null');
      });

      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('refreshUser', () => {
    it('refreshUserでユーザー情報を再取得', async () => {
      const initialUser = {
        id: 1,
        email: 'test@example.com',
        name: 'テスト薬局',
        prefecture: '東京都',
        isAdmin: false,
      };
      const refreshedUser = {
        ...initialUser,
        name: '更新された薬局名',
      };

      mockApi.get
        .mockResolvedValueOnce(initialUser)
        .mockResolvedValueOnce(refreshedUser);

      renderAuthContext();

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('false');
      });

      screen.getByTestId('refresh').click();

      await waitFor(() => {
        const userText = screen.getByTestId('user').textContent;
        const parsedUser = JSON.parse(userText!);
        expect(parsedUser.name).toBe('更新された薬局名');
      });
    });

    it('refreshUser失敗でuserがnullになる', async () => {
      const mockUser = {
        id: 1,
        email: 'test@example.com',
        name: 'テスト薬局',
        prefecture: '東京都',
        isAdmin: false,
      };

      mockApi.get
        .mockResolvedValueOnce(mockUser)
        .mockRejectedValueOnce(new Error('Session expired'));

      renderAuthContext();

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('false');
      });

      screen.getByTestId('refresh').click();

      await waitFor(() => {
        expect(screen.getByTestId('user').textContent).toBe('null');
      });
    });
  });

  describe('認証期限切れハンドラ', () => {
    it('AuthProviderがsetAuthExpiredHandlerを登録する', async () => {
      mockApi.get.mockRejectedValue(new Error('Unauthorized'));

      renderAuthContext();

      await waitFor(() => {
        expect(mockSetAuthExpiredHandler).toHaveBeenCalled();
      });
    });
  });
});

describe('useAuth', () => {
  it('AuthProvider外で使用するとエラー', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<TestConsumer />);
    }).toThrow('useAuth must be used within an AuthProvider');

    consoleError.mockRestore();
  });
});
