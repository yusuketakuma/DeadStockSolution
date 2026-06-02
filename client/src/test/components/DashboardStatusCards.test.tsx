import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import DashboardStatusCards from '../../components/dashboard/DashboardStatusCards';

describe('DashboardStatusCards', () => {
  it('renders a disabled button for matching when used-medication data is missing', () => {
    render(
      <MemoryRouter>
        <DashboardStatusCards
          userName="テスト"
          status={{ deadStockUploaded: true, usedMedicationUploaded: false, lastDeadStockUpload: null, lastUsedMedicationUpload: null }}
        />
      </MemoryRouter>,
    );

    // When usedMedicationUploaded is false, the matching action renders as a disabled span, not a button
    const el = screen.getByText('マッチングを実行');
    expect(el.tagName).toBe('SPAN');
    expect(el).toHaveClass('disabled');
  });

  it('keeps inventory shortcuts behind related menus on upload cards', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <DashboardStatusCards
          userName="テスト"
          status={{ deadStockUploaded: true, usedMedicationUploaded: true, lastDeadStockUpload: null, lastUsedMedicationUpload: null }}
        />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole('link', { name: 'アップロード' })).toHaveLength(2);
    expect(screen.queryByRole('link', { name: '在庫を確認' })).not.toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: '関連' })[0]);
    expect(screen.getByRole('link', { name: '在庫を確認' })).toHaveAttribute('href', '/inventory/dead-stock');
  });
});
