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
        packageLabel: '100錠箱',
        packageQuantity: 100,
        packageUnit: '錠',
        boxCount: 2,
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
        packageLabel: '100錠箱',
        packageQuantity: 100,
        packageUnit: '錠',
        boxCount: 2,
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
  it('disables confirmation when box count exceeds the original stock amount', async () => {
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
    await user.type(quantityInputs[0], '3');

    expect(await screen.findByText(/元箱数 2箱を超えられません/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '仮マッチングを開始' })).toBeDisabled();
  });

  it('submits adjusted box counts as package-multiple quantities when values remain valid', async () => {
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
    await user.type(quantityInputs[0], '1');
    await user.clear(quantityInputs[1]);
    await user.type(quantityInputs[1], '1');
    await user.click(screen.getByRole('button', { name: '仮マッチングを開始' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        totalValueA: 10000,
        totalValueB: 10000,
        valueDifference: 0,
        itemsFromA: [expect.objectContaining({ deadStockItemId: 101, quantity: 100, boxCount: 1, yakkaValue: 10000 })],
        itemsFromB: [expect.objectContaining({ deadStockItemId: 202, quantity: 100, boxCount: 1, yakkaValue: 10000 })],
      }),
    );
  });
});
