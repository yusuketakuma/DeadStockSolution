import { Table } from 'react-bootstrap';
import InventoryMatrixCell from './InventoryMatrixCell';
import type { PrescriptionSearchResponse } from '../../api/client';

type MatrixColumn = PrescriptionSearchResponse['matrix']['columns'][number];
type MatrixRow = PrescriptionSearchResponse['matrix']['rows'][number];

interface Props {
  columns: MatrixColumn[];
  rows: MatrixRow[];
  totalDrugs: number;
}

export default function InventoryMatrix({ columns, rows, totalDrugs }: Props) {
  if (rows.length === 0) {
    return <p className="text-muted text-center mt-3">在庫が見つかりませんでした</p>;
  }

  return (
    <div className="table-responsive">
      <Table bordered hover size="sm" className="mb-0">
        <thead>
          <tr>
            <th style={{ position: 'sticky', left: 0, background: 'var(--bs-table-bg, #fff)', zIndex: 2, minWidth: 120 }}>
              薬局
            </th>
            {columns.map((col, i) => (
              <th key={i} style={{ position: 'sticky', top: 0, zIndex: 1, minWidth: 150 }}>
                {col.columnLabel}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const matchedCount = row.cells.filter(c => c.available).length;
            return (
              <tr key={row.pharmacyId}>
                <td style={{ position: 'sticky', left: 0, background: 'var(--bs-table-bg, #fff)', zIndex: 1 }}>
                  <div className="fw-bold small">{row.pharmacyName}</div>
                  <small className="text-muted">{matchedCount}/{totalDrugs}</small>
                </td>
                {row.cells.map((cell, i) => (
                  <InventoryMatrixCell key={i} available={cell.available} items={cell.items} />
                ))}
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
