import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AppDropdownMenu from '../../components/ui/AppDropdownMenu';
import { renderWithProviders } from '../helpers';

describe('AppDropdownMenu', () => {
  it('opens links and closes with Escape', async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <AppDropdownMenu
        label="関連画面"
        items={[
          { key: 'quality', to: '/upload-quality', label: '品質を確認' },
          { key: 'external', href: 'https://example.com/report.csv', label: 'レポートを開く' },
        ]}
      />,
    );

    const toggle = screen.getByRole('button', { name: '関連画面' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: '品質を確認' })).toHaveAttribute('href', '/upload-quality');
    expect(screen.getByRole('link', { name: 'レポートを開く' })).toHaveAttribute('href', 'https://example.com/report.csv');

    await user.keyboard('{Escape}');

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: '品質を確認' })).not.toBeInTheDocument();
  });

  it('does not run disabled item actions', async () => {
    const user = userEvent.setup();
    const handleDangerAction = vi.fn();

    renderWithProviders(
      <AppDropdownMenu
        label="選択操作"
        items={[
          { key: 'disabled', label: '一括辞退', onClick: handleDangerAction, disabled: true, danger: true },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: '選択操作' }));
    const disabledItem = screen.getByRole('button', { name: '一括辞退' });

    expect(disabledItem).toBeDisabled();

    await user.click(disabledItem);

    expect(handleDangerAction).not.toHaveBeenCalled();
  });
});
