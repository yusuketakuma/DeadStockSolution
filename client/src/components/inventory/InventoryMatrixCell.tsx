import type { MatrixCell } from '../../api/client';

type Props = MatrixCell;

export default function InventoryMatrixCell({ available, items }: Props) {
  if (!available) {
    return <td className="table-danger text-center text-muted">なし</td>;
  }

  return (
    <td>
      {items.map((item, i) => (
        <div key={i} className={i > 0 ? 'mt-1 pt-1 border-top' : ''}>
          <div className="fw-semibold small">
            {item.manufacturer ?? '—'} ¥{item.yakkaUnitPrice?.toLocaleString() ?? '—'}
          </div>
          <div className="text-muted small">
            {item.quantity}{item.unit ?? ''}
          </div>
        </div>
      ))}
    </td>
  );
}
