import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Sidebar from '../../components/Sidebar';

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, name: '管理者', isAdmin: true },
    logout: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../hooks/useAdminBadgeCounts', () => ({
  useAdminBadgeCounts: () => ({ pendingRequests: 0, reports: 0, alerts: 0 }),
}));

vi.mock('../../hooks/useUserBadgeCounts', () => ({
  useUserBadgeCounts: () => ({ proposals: 0, alerts: 0, groups: 0 }),
}));

describe('Sidebar', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders static sidebar groups and links for admin users', () => {
    render(
      <MemoryRouter>
        <Sidebar isOpen={false} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getAllByText('管理者')).toHaveLength(2);
    expect(screen.getByText('主要操作')).toBeInTheDocument();
    expect(screen.getByText('在庫・参照')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'OpenClaw連携' })).toHaveAttribute('href', '/admin/openclaw');
    expect(screen.getByRole('link', { name: 'ダッシュボード' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: '薬局一覧' })).toHaveAttribute('href', '/pharmacies');
    expect(screen.getByRole('button', { name: 'ログアウト' })).toBeInTheDocument();
  });
});
