import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PharmacySummaryCards from '../../components/inventory/PharmacySummaryCards';

const summary = {
  pharmacyId: 5,
  pharmacyName: 'テスト薬局',
  matchedCount: 2,
  totalDrugs: 2,
  totalYakka: 1234,
  distance: 1.2,
  businessStatus: { isOpen: true, message: '09:00〜18:00', isConfigured: true },
  isFavorite: true,
  isGroupMember: true,
};

describe('PharmacySummaryCards', () => {
  it('opens the matching flow from the summary CTA', async () => {
    const user = userEvent.setup();
    const onOpenMatching = vi.fn();

    render(
      <PharmacySummaryCards
        summaries={[summary]}
        onOpenMatching={onOpenMatching}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'マッチング候補を確認' }));

    expect(onOpenMatching).toHaveBeenCalledWith(5);
  });
});
