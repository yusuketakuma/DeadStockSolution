import { render, screen } from '@testing-library/react';
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
});
