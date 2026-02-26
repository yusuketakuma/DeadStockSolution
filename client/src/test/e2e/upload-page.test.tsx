import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UploadPage from '../../pages/UploadPage';
import { mockUser, renderWithProviders, setupFetchMock } from '../helpers';

describe('UploadPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows used-medication required fields aligned with backend schema', async () => {
    setupFetchMock({
      '/api/auth/me': mockUser,
    });

    renderWithProviders(<UploadPage />);

    await waitFor(() => {
      expect(screen.getByText('Excelアップロード')).toBeInTheDocument();
    });
    expect(screen.getByText('YJコード / GS1コード、薬剤名、数量、包装単位、期限')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('アップロードタイプ'), 'used_medication');

    expect(screen.getByText('薬剤名、月間使用量')).toBeInTheDocument();
    expect(screen.queryByText('YJコード / GS1コード、薬剤名、数量、包装単位、期限、月間使用量')).not.toBeInTheDocument();
  });
});
