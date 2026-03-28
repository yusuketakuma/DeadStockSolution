import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProposalQuantityAdjustModal from '../../components/matching/ProposalQuantityAdjustModal';
import type { MatchCandidate } from '../../types/matching';

function makeCandidate(): MatchCandidate {
  return {
    pharmacyId: 2,
    pharmacyName: '相手薬局',
    distance: 3,
    itemsFromA: [
      {
        deadStockItemId: 101,
        drugName: '薬A',
        quantity: 200,
        unit: '錠',
        yakkaUnitPrice: 100,
        yakkaValue: 20000,
      },
    ],
    itemsFromB: [
      {
        deadStockItemId: 202,
        drugName: '薬B',
        quantity: 200,
        unit: '錠',
        yakkaUnitPrice: 100,
        yakkaValue: 20000,
      },
    ],
    totalValueA: 20000,
    totalValueB: 20000,
    valueDifference: 0,
    score: 90,
    matchRate: 0.95,
  };
}

describe('ProposalQuantityAdjustModal', () => {
  it('disables confirmation when quantity exceeds the original stock amount', async () => {
    const user = userEvent.setup();

    render(
      <ProposalQuantityAdjustModal
        show
        candidate={makeCandidate()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    const quantityInputs = screen.getAllByRole('spinbutton');
    await user.clear(quantityInputs[0]);
    await user.type(quantityInputs[0], '250');

    expect(await screen.findByText(/元数量 200 を超えられません/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '仮マッチングを開始' })).toBeDisabled();
  });

  it('submits adjusted quantities and recalculated totals when values remain valid', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <ProposalQuantityAdjustModal
        show
        candidate={makeCandidate()}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    const quantityInputs = screen.getAllByRole('spinbutton');
    await user.clear(quantityInputs[0]);
    await user.type(quantityInputs[0], '150');
    await user.clear(quantityInputs[1]);
    await user.type(quantityInputs[1], '150');
    await user.click(screen.getByRole('button', { name: '仮マッチングを開始' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        totalValueA: 15000,
        totalValueB: 15000,
        valueDifference: 0,
        itemsFromA: [expect.objectContaining({ deadStockItemId: 101, quantity: 150, yakkaValue: 15000 })],
        itemsFromB: [expect.objectContaining({ deadStockItemId: 202, quantity: 150, yakkaValue: 15000 })],
      }),
    );
  });
});
