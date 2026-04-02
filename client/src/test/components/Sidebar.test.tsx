import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Sidebar from '../../components/Sidebar';

const authState = {
  user: { id: 1, name: '管理者', isAdmin: true },
  logout: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('../../api/messages', () => ({
  fetchUnreadCount: vi.fn().mockResolvedValue({ unreadCount: 3 }),
}));

import { fetchUnreadCount } from '../../api/messages';

describe('Sidebar', () => {
  beforeEach(() => {
    window.localStorage.clear();
    authState.user = { id: 1, name: '管理者', isAdmin: true };
    vi.mocked(fetchUnreadCount).mockResolvedValue({ unreadCount: 3 });
  });

  it('renders static sidebar groups and links for admin users', () => {
    render(
      <MemoryRouter>
        <Sidebar isOpen={false} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getAllByText('管理者')).toHaveLength(2);
    expect(screen.getByText('主要操作')).toBeInTheDocument();
    expect(screen.getByText('通知・対応')).toBeInTheDocument();
    expect(screen.getByText('在庫・参照')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'OpenClaw連携' })).toHaveAttribute('href', '/admin/openclaw');
    expect(screen.getByRole('link', { name: 'マッチング実験' })).toHaveAttribute('href', '/admin/matching-experiments');
    expect(screen.getByRole('link', { name: '通知・配信状況' })).toHaveAttribute('href', '/admin/notifications');
    expect(screen.getAllByRole('link', { name: 'アップロード品質' }).some((link) => link.getAttribute('href') === '/admin/upload-quality')).toBe(true);
    expect(screen.getByRole('link', { name: 'エラーコード' })).toHaveAttribute('href', '/admin/error-codes');
    expect(screen.getByRole('link', { name: 'ユーザー間メッセージ' })).toHaveAttribute('href', '/admin/direct-messages');
    expect(screen.getByRole('link', { name: 'ダッシュボード' })).toHaveAttribute('href', '/');
    expect(screen.getAllByRole('link', { name: 'アップロード品質' }).some((link) => link.getAttribute('href') === '/upload-quality')).toBe(true);
    expect(screen.getByRole('link', { name: '通知センター' })).toHaveAttribute('href', '/notifications');
    expect(screen.getByRole('link', { name: 'ブックマーク' })).toHaveAttribute('href', '/bookmarks');
    expect(screen.getByRole('link', { name: '薬局一覧' })).toHaveAttribute('href', '/pharmacies');
    expect(screen.getByRole('link', { name: '操作ログ' })).toHaveAttribute('href', '/admin/logs');
    expect(screen.getByRole('link', { name: '監査ログ' })).toHaveAttribute('href', '/admin/audit');
    expect(screen.getByRole('button', { name: 'ログアウト' })).toBeInTheDocument();
    expect(screen.queryByLabelText('サイドバーを折りたたむ')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('サイドバーを展開')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'メッセージ' })).not.toBeInTheDocument();
  });

  it('shows unread badge on message link for pharmacy users', async () => {
    authState.user = { id: 2, name: 'テスト薬局', isAdmin: false };

    render(
      <MemoryRouter>
        <Sidebar isOpen={false} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    expect(await screen.findAllByLabelText('3件の未読メッセージ')).toHaveLength(1);
    expect(fetchUnreadCount).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: /メッセージ/ })).toHaveAttribute('href', '/messages');
  });
});
