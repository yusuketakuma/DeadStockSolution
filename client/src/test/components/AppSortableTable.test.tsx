import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import AppSortableTable, { type SortableColumn } from '../../components/ui/AppSortableTable';
import { renderWithProviders } from '../helpers';

interface Row extends Record<string, unknown> {
  id: number;
  name: string;
  value: number;
}

const columns: SortableColumn<Row>[] = [
  { key: 'name', label: '名前', sortable: true },
  { key: 'value', label: '値', sortable: true },
  { key: 'id', label: 'ID', sortable: false },
];

const sampleData: Row[] = [
  { id: 1, name: 'バナナ', value: 30 },
  { id: 2, name: 'アップル', value: 10 },
  { id: 3, name: 'チェリー', value: 20 },
];

function renderRow(row: Row, index: number) {
  return (
    <tr key={index}>
      <td>{row.name}</td>
      <td>{row.value}</td>
      <td>{row.id}</td>
    </tr>
  );
}

describe('AppSortableTable', () => {
  it('should render table with column headers and row data', () => {
    renderWithProviders(
      <AppSortableTable columns={columns} data={sampleData} renderRow={renderRow} />,
    );

    expect(screen.getByText('名前')).toBeInTheDocument();
    expect(screen.getByText('値')).toBeInTheDocument();
    expect(screen.getByText('ID')).toBeInTheDocument();

    expect(screen.getByText('バナナ')).toBeInTheDocument();
    expect(screen.getByText('アップル')).toBeInTheDocument();
    expect(screen.getByText('チェリー')).toBeInTheDocument();
  });

  it('should cycle sort direction asc -> desc -> none when clicking the same sortable header', () => {
    renderWithProviders(
      <AppSortableTable columns={columns} data={sampleData} renderRow={renderRow} />,
    );

    const nameHeader = screen.getByText('名前').closest('th')!;

    // Initial state: no sort (⇅ indicator shown)
    expect(nameHeader).not.toHaveAttribute('aria-sort');

    // Click 1 -> asc
    fireEvent.click(nameHeader);
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');

    // Click 2 -> desc
    fireEvent.click(nameHeader);
    expect(nameHeader).toHaveAttribute('aria-sort', 'descending');

    // Click 3 -> none
    fireEvent.click(nameHeader);
    expect(nameHeader).not.toHaveAttribute('aria-sort');
  });

  it('should reset sort to asc when clicking a different sortable column', () => {
    renderWithProviders(
      <AppSortableTable columns={columns} data={sampleData} renderRow={renderRow} />,
    );

    const nameHeader = screen.getByText('名前').closest('th')!;
    const valueHeader = screen.getByText('値').closest('th')!;

    // Sort by name asc then desc
    fireEvent.click(nameHeader);
    fireEvent.click(nameHeader);
    expect(nameHeader).toHaveAttribute('aria-sort', 'descending');

    // Switch to value column -> resets to asc
    fireEvent.click(valueHeader);
    expect(valueHeader).toHaveAttribute('aria-sort', 'ascending');
    expect(nameHeader).not.toHaveAttribute('aria-sort');
  });

  it('should not react to clicks on non-sortable column headers', () => {
    renderWithProviders(
      <AppSortableTable columns={columns} data={sampleData} renderRow={renderRow} />,
    );

    const idHeader = screen.getByText('ID').closest('th')!;
    fireEvent.click(idHeader);
    expect(idHeader).not.toHaveAttribute('aria-sort');
  });

  it('should show ▲ indicator when sorted ascending', () => {
    renderWithProviders(
      <AppSortableTable columns={columns} data={sampleData} renderRow={renderRow} />,
    );

    const nameHeader = screen.getByText('名前').closest('th')!;
    fireEvent.click(nameHeader);

    expect(nameHeader.textContent).toContain('▲');
  });

  it('should show ▼ indicator when sorted descending', () => {
    renderWithProviders(
      <AppSortableTable columns={columns} data={sampleData} renderRow={renderRow} />,
    );

    const nameHeader = screen.getByText('名前').closest('th')!;
    fireEvent.click(nameHeader);
    fireEvent.click(nameHeader);

    expect(nameHeader.textContent).toContain('▼');
  });

  it('should show ⇅ indicator when sort is cleared', () => {
    renderWithProviders(
      <AppSortableTable columns={columns} data={sampleData} renderRow={renderRow} />,
    );

    const nameHeader = screen.getByText('名前').closest('th')!;
    // Three clicks to cycle back to none
    fireEvent.click(nameHeader);
    fireEvent.click(nameHeader);
    fireEvent.click(nameHeader);

    expect(nameHeader.textContent).toContain('⇅');
  });

  it('should display InlineLoader when loading is true', () => {
    renderWithProviders(
      <AppSortableTable
        columns={columns}
        data={[]}
        renderRow={renderRow}
        loading={true}
        loadingText="データを取得しています"
      />,
    );

    // InlineLoader renders a role="status" element
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('データを取得しています')).toBeInTheDocument();
  });

  it('should display default loading text when loading is true and no loadingText given', () => {
    renderWithProviders(
      <AppSortableTable columns={columns} data={[]} renderRow={renderRow} loading={true} />,
    );

    expect(screen.getByText('読み込み中...')).toBeInTheDocument();
  });

  it('should display emptyTitle when data is empty and not loading', () => {
    renderWithProviders(
      <AppSortableTable
        columns={columns}
        data={[]}
        renderRow={renderRow}
        emptyTitle="該当データなし"
      />,
    );

    expect(screen.getByText('該当データなし')).toBeInTheDocument();
  });

  it('should display default emptyTitle when data is empty', () => {
    renderWithProviders(
      <AppSortableTable columns={columns} data={[]} renderRow={renderRow} />,
    );

    expect(screen.getByText('データがありません')).toBeInTheDocument();
  });

  it('should not render table element when data is empty', () => {
    renderWithProviders(
      <AppSortableTable columns={columns} data={[]} renderRow={renderRow} />,
    );

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('should not render table element when loading', () => {
    renderWithProviders(
      <AppSortableTable columns={columns} data={[]} renderRow={renderRow} loading={true} />,
    );

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('should render correct number of rows', () => {
    renderWithProviders(
      <AppSortableTable columns={columns} data={sampleData} renderRow={renderRow} />,
    );

    const rows = screen.getAllByRole('row');
    // 1 header row + 3 data rows
    expect(rows).toHaveLength(4);
  });
});
