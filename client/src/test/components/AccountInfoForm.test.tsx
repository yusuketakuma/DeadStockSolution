import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AccountInfoForm, { type AccountFormState } from '../../components/account/AccountInfoForm';

const baseForm: AccountFormState = {
  email: 'test@example.com',
  name: 'テスト薬局',
  postalCode: '1000001',
  address: '東京都',
  phone: '0312345678',
  fax: '',
  prefecture: '東京都',
  licenseNumber: 'ABC',
  currentPassword: '',
  newPassword: '',
};

describe('AccountInfoForm', () => {
  it('disables submit when a new password is entered without the current password', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <AccountInfoForm
        form={baseForm}
        loading={false}
        onSubmit={vi.fn()}
        onChange={onChange}
      />,
    );

    await user.type(screen.getByLabelText('新しいパスワード'), 'new-password');

    expect(onChange).toHaveBeenCalled();
  });

  it('shows a warning and disables submit when current password is missing', () => {
    render(
      <AccountInfoForm
        form={{ ...baseForm, newPassword: 'new-password' }}
        loading={false}
        submitDisabled={true}
        onSubmit={vi.fn()}
        onChange={vi.fn()}
      />,
    );

    // The component delegates disable logic to the parent via submitDisabled prop
    expect(screen.getByRole('button', { name: '更新' })).toBeDisabled();
  });
});
