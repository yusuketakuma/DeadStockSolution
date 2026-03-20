import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PrescriptionSearchForm from '../../components/inventory/PrescriptionSearchForm';
import type { DrugChip, PrescriptionSearchFilters } from '../../api/client';

// SearchInput uses api.get internally; mock the module to keep tests fast/isolated
vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: vi.fn().mockResolvedValue([]),
    },
  };
});

// BarcodeScanButton relies on camera APIs not available in jsdom
vi.mock('../../components/mobile/BarcodeScanButton', () => ({
  default: () => null,
}));

const defaultFilters: PrescriptionSearchFilters = {
  groupOnly: false,
  openOnly: false,
  favoritePriority: false,
};

function makeChip(override: Partial<DrugChip> = {}): DrugChip {
  return {
    drugMasterId: 1,
    genericName: 'アスピリン',
    specification: '100mg',
    displayLabel: 'アスピリン 100mg',
    ...override,
  };
}

describe('PrescriptionSearchForm', () => {
  it('calls onRemoveChip with the correct index when the × button is clicked', async () => {
    const user = userEvent.setup();
    const onRemoveChip = vi.fn();

    render(
      <PrescriptionSearchForm
        chips={[makeChip({ drugMasterId: 1, displayLabel: 'アスピリン 100mg' })]}
        onAddChip={vi.fn()}
        onRemoveChip={onRemoveChip}
        filters={defaultFilters}
        onFiltersChange={vi.fn()}
        onSearch={vi.fn()}
        isSearching={false}
        isGroupMember={true}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'アスピリン 100mgを削除' }));

    expect(onRemoveChip).toHaveBeenCalledOnce();
    expect(onRemoveChip).toHaveBeenCalledWith(0);
  });

  it('disables the search button when chips is empty', () => {
    render(
      <PrescriptionSearchForm
        chips={[]}
        onAddChip={vi.fn()}
        onRemoveChip={vi.fn()}
        filters={defaultFilters}
        onFiltersChange={vi.fn()}
        onSearch={vi.fn()}
        isSearching={false}
        isGroupMember={true}
      />,
    );

    expect(screen.getByRole('button', { name: '在庫を検索' })).toBeDisabled();
  });

  it('enables the search button and calls onSearch when chips exist', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();

    render(
      <PrescriptionSearchForm
        chips={[makeChip()]}
        onAddChip={vi.fn()}
        onRemoveChip={vi.fn()}
        filters={defaultFilters}
        onFiltersChange={vi.fn()}
        onSearch={onSearch}
        isSearching={false}
        isGroupMember={true}
      />,
    );

    const button = screen.getByRole('button', { name: '在庫を検索' });
    expect(button).not.toBeDisabled();

    await user.click(button);

    expect(onSearch).toHaveBeenCalledOnce();
  });

  it('calls onFiltersChange when the 営業中のみ checkbox is toggled', async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();

    const { container } = render(
      <PrescriptionSearchForm
        chips={[]}
        onAddChip={vi.fn()}
        onRemoveChip={vi.fn()}
        filters={defaultFilters}
        onFiltersChange={onFiltersChange}
        onSearch={vi.fn()}
        isSearching={false}
        isGroupMember={true}
      />,
    );

    // React Bootstrap Form.Check does not wire htmlFor in jsdom; locate the checkbox
    // by finding its sibling label element containing the target text.
    const label = Array.from(container.querySelectorAll('.form-check-label')).find(
      (el) => el.textContent?.trim() === '営業中のみ',
    );
    const checkbox = label?.previousElementSibling as HTMLInputElement | null;
    if (!checkbox) throw new Error('checkbox not found');
    await user.click(checkbox);

    expect(onFiltersChange).toHaveBeenCalledOnce();
  });

  it('calls onFiltersChange when the グループ内のみ checkbox is toggled (group member)', async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();

    const { container } = render(
      <PrescriptionSearchForm
        chips={[]}
        onAddChip={vi.fn()}
        onRemoveChip={vi.fn()}
        filters={defaultFilters}
        onFiltersChange={onFiltersChange}
        onSearch={vi.fn()}
        isSearching={false}
        isGroupMember={true}
      />,
    );

    const label = Array.from(container.querySelectorAll('.form-check-label')).find(
      (el) => el.textContent?.trim() === 'グループ内のみ',
    );
    const checkbox = label?.previousElementSibling as HTMLInputElement | null;
    if (!checkbox) throw new Error('checkbox not found');
    await user.click(checkbox);

    expect(onFiltersChange).toHaveBeenCalledOnce();
  });
});
