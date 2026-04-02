import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import AdminBulkActionsPage from '../../pages/admin/AdminBulkActionsPage';
import { mockAdminUser, renderWithProviders } from '../helpers';

describe('AdminBulkActionsPage', () => {
  it('surfaces nearby audit and pharmacy-operation routes before executing bulk actions', () => {
    renderWithProviders(<AdminBulkActionsPage />, {
      route: '/admin/bulk-actions',
      authUser: mockAdminUser,
    });

    expect(screen.getByText('一括操作')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '薬局管理' }).some((link) => link.getAttribute('href') === '/admin/pharmacies')).toBe(true);
    expect(screen.getAllByRole('link', { name: '監査ログ' }).some((link) => link.getAttribute('href') === '/admin/audit')).toBe(true);
  });
});
