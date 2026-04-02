import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import Header from '../../components/Header';
import { mockAdminUser, mockUser, renderWithProviders } from '../helpers';

describe('Header quick actions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('prioritizes upload quality shortcuts on inventory routes', () => {
    renderWithProviders(<Header onToggleSidebar={vi.fn()} />, {
      route: '/inventory/dead-stock',
      authUser: mockUser,
    });

    expect(screen.getAllByRole('link', { name: 'アップロード品質' }).some((link) => link.getAttribute('href') === '/upload-quality')).toBe(true);
    expect(screen.getAllByRole('link', { name: 'マッチング' }).some((link) => link.getAttribute('href') === '/matching')).toBe(true);
  });

  it('links matching-related admin routes together', () => {
    renderWithProviders(<Header onToggleSidebar={vi.fn()} />, {
      route: '/admin/matching-rules',
      authUser: mockAdminUser,
    });

    expect(screen.getAllByRole('link', { name: 'マッチング実験' }).some((link) => link.getAttribute('href') === '/admin/matching-experiments')).toBe(true);
    expect(screen.getAllByRole('link', { name: 'マッチング性能' }).some((link) => link.getAttribute('href') === '/admin/matching-performance')).toBe(true);
  });

  it('links pharmacy-operations admin routes together', () => {
    renderWithProviders(<Header onToggleSidebar={vi.fn()} />, {
      route: '/admin/pharmacy-health',
      authUser: mockAdminUser,
    });

    expect(screen.getAllByRole('link', { name: '薬局管理' }).some((link) => link.getAttribute('href') === '/admin/pharmacies')).toBe(true);
    expect(screen.getAllByRole('link', { name: '営業時間' }).some((link) => link.getAttribute('href') === '/admin/business-hours')).toBe(true);
  });

  it('links bulk-action routes back to requests and audit flows', () => {
    renderWithProviders(<Header onToggleSidebar={vi.fn()} />, {
      route: '/admin/bulk-actions',
      authUser: mockAdminUser,
    });

    expect(screen.getAllByRole('link', { name: '薬局管理' }).some((link) => link.getAttribute('href') === '/admin/pharmacies')).toBe(true);
    expect(screen.getAllByRole('link', { name: 'ユーザーリクエスト管理' }).some((link) => link.getAttribute('href') === '/admin/user-requests')).toBe(true);
  });

  it('links rate-limit routes back to logs and business-hours operations', () => {
    renderWithProviders(<Header onToggleSidebar={vi.fn()} />, {
      route: '/admin/rate-limits',
      authUser: mockAdminUser,
    });

    expect(screen.getAllByRole('link', { name: 'ログセンター' }).some((link) => link.getAttribute('href') === '/admin/log-center')).toBe(true);
    expect(screen.getAllByRole('link', { name: '営業時間' }).some((link) => link.getAttribute('href') === '/admin/business-hours')).toBe(true);
  });

  it('avoids duplicating request shortcuts on communication routes', () => {
    renderWithProviders(<Header onToggleSidebar={vi.fn()} />, {
      route: '/notifications',
      authUser: mockUser,
    });

    expect(screen.queryAllByRole('link', { name: '通知センター' }).some((link) => link.getAttribute('href') === '/notifications')).toBe(false);
    expect(screen.getAllByRole('link', { name: 'メッセージ' }).some((link) => link.getAttribute('href') === '/messages')).toBe(true);
    expect(screen.getAllByRole('link', { name: '薬局設定' }).some((link) => link.getAttribute('href') === '/account')).toBe(true);
    expect(screen.queryAllByRole('link', { name: '要望対応' })).toHaveLength(0);
  });
});
