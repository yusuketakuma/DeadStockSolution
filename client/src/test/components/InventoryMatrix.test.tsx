import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import InventoryMatrix from '../../components/inventory/InventoryMatrix';

const sampleColumn = {
  genericName: 'アスピリン',
  specification: '100mg',
  columnLabel: 'アスピリン 100mg',
};

const sampleItem = {
  drugName: 'アスピリン錠100mg',
  manufacturer: 'バイエル',
  yakkaUnitPrice: 10,
  quantity: 100,
  unit: '錠',
};

describe('InventoryMatrix', () => {
  it('shows 在庫が見つかりませんでした when rows is empty', () => {
    render(<InventoryMatrix columns={[sampleColumn]} rows={[]} totalDrugs={1} />);

    expect(screen.getByText('在庫が見つかりませんでした')).toBeInTheDocument();
  });

  it('renders the column header label', () => {
    const rows = [
      {
        pharmacyId: 1,
        pharmacyName: 'テスト薬局',
        cells: [{ available: true, items: [sampleItem] }],
      },
    ];

    render(<InventoryMatrix columns={[sampleColumn]} rows={rows} totalDrugs={1} />);

    expect(screen.getByRole('columnheader', { name: 'アスピリン 100mg' })).toBeInTheDocument();
  });

  it('shows drug name, price, and quantity when cell is available', () => {
    const rows = [
      {
        pharmacyId: 1,
        pharmacyName: 'テスト薬局',
        cells: [{ available: true, items: [sampleItem] }],
      },
    ];

    render(<InventoryMatrix columns={[sampleColumn]} rows={rows} totalDrugs={1} />);

    // Manufacturer and yakka price appear together in the cell
    expect(screen.getByText(/バイエル.*¥10/, { selector: 'div' })).toBeInTheDocument();
    // Quantity and unit
    expect(screen.getByText('100錠')).toBeInTheDocument();
  });

  it('shows なし when the cell is not available', () => {
    const rows = [
      {
        pharmacyId: 1,
        pharmacyName: 'テスト薬局',
        cells: [{ available: false, items: [] }],
      },
    ];

    render(<InventoryMatrix columns={[sampleColumn]} rows={rows} totalDrugs={1} />);

    expect(screen.getByText('なし')).toBeInTheDocument();
  });

  it('renders a row for each pharmacy with its name', () => {
    const rows = [
      {
        pharmacyId: 1,
        pharmacyName: '薬局A',
        cells: [{ available: false, items: [] }],
      },
      {
        pharmacyId: 2,
        pharmacyName: '薬局B',
        cells: [{ available: false, items: [] }],
      },
    ];

    render(<InventoryMatrix columns={[sampleColumn]} rows={rows} totalDrugs={1} />);

    expect(screen.getByText('薬局A')).toBeInTheDocument();
    expect(screen.getByText('薬局B')).toBeInTheDocument();
  });

  it('renders matched count per row', () => {
    const rows = [
      {
        pharmacyId: 1,
        pharmacyName: 'テスト薬局',
        cells: [
          { available: true, items: [sampleItem] },
          { available: false, items: [] },
        ],
      },
    ];

    render(<InventoryMatrix columns={[sampleColumn, sampleColumn]} rows={rows} totalDrugs={2} />);

    // matched 1 out of totalDrugs 2 — but totalDrugs prop is used for the "/N" part
    const row = screen.getByRole('row', { name: /テスト薬局/ });
    expect(within(row).getByText('1/2')).toBeInTheDocument();
  });
});
