import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AccountPage from '../../pages/AccountPage';
import { mockUser, renderWithProviders, setupFetchMock } from '../helpers';

vi.mock('../../components/account/AccountInfoForm', () => ({
  default: () => <div>AccountInfoForm</div>,
}));

vi.mock('../../components/account/BusinessHoursSettings', () => ({
  default: () => <div>BusinessHoursSettings</div>,
}));

vi.mock('../../components/account/SubscriptionSection', () => ({
  default: () => null,
}));

vi.mock('../../components/account/WithdrawSection', () => ({
  default: () => <div>WithdrawSection</div>,
}));

vi.mock('../../components/account/PushNotificationSettings', () => ({
  default: () => null,
}));

vi.mock('../../components/ConflictAlert', () => ({
  default: () => null,
}));

vi.mock('../../components/DraftRestoreAlert', () => ({
  default: () => null,
}));

vi.mock('../../components/ConfirmActionModal', () => ({
  default: () => null,
}));

describe('AccountPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows action-based shortcuts for post-settings checks', async () => {
    setupFetchMock({
      '/api/auth/me': mockUser,
      '/api/account': {
        id: 1,
        email: 'test@example.com',
        name: 'テスト薬局',
        postalCode: '1500001',
        address: '東京都渋谷区1-1-1',
        phone: '03-1111-1111',
        fax: '03-1111-2222',
        licenseNumber: 'LIC-001',
        prefecture: '東京都',
        version: 1,
        matchingAutoNotifyEnabled: true,
      },
      '/api/business-hours/settings': {
        hours: [],
        specialHours: [],
        version: 1,
      },
    });

    renderWithProviders(<AccountPage />, { route: '/account', authUser: mockUser });

    await waitFor(() => {
      expect(screen.getByText('設定後に確認する画面')).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: 'ダッシュボードを確認' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: '薬局を確認' })).toHaveAttribute('href', '/pharmacies');
    expect(screen.getByRole('link', { name: '品質を確認' })).toHaveAttribute('href', '/upload-quality');
    expect(screen.getAllByRole('link', { name: '統計を確認' }).some((link) => link.getAttribute('href') === '/statistics')).toBe(true);
    expect(screen.getByRole('link', { name: '通知を確認' })).toHaveAttribute('href', '/notifications');
    expect(screen.getByRole('link', { name: 'メッセージを確認' })).toHaveAttribute('href', '/messages');
    expect(screen.getByRole('link', { name: 'グループを確認' })).toHaveAttribute('href', '/groups');
  });
});
