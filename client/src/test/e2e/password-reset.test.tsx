import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PasswordResetPage from '../../pages/PasswordResetPage';
import { renderWithProviders } from '../helpers';

function mockCommonFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/auth/me')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/api/auth/password-reset/request')) {
      return new Response(JSON.stringify({ message: '送信しました' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/api/auth/password-reset/confirm')) {
      return new Response(JSON.stringify({ message: '再設定しました' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }));
}

describe('PasswordResetPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders request step by default', async () => {
    mockCommonFetch();
    renderWithProviders(<PasswordResetPage />, { route: '/password-reset' });

    await waitFor(() => {
      expect(screen.getByText('パスワードリセット')).toBeInTheDocument();
    });

    expect(screen.getByLabelText('メールアドレス')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'リセットリンクを送信' })).toBeInTheDocument();
  });

  it('switches to confirm step from request step', async () => {
    const user = userEvent.setup();
    mockCommonFetch();
    renderWithProviders(<PasswordResetPage />, { route: '/password-reset' });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'パスワード再設定へ' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'パスワード再設定へ' }));

    await waitFor(() => {
      expect(screen.getByLabelText('リセットトークン')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'パスワードを再設定' })).toBeInTheDocument();
    });
  });
});
