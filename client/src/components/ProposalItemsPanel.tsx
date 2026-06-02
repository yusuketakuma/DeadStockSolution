import { Badge } from 'react-bootstrap';
import AppDataPanel from './ui/AppDataPanel';
import AppTable from './ui/AppTable';
import AppMobileDataCard from './ui/AppMobileDataCard';
import AppResponsiveSwitch from './ui/AppResponsiveSwitch';

interface PanelItem {
  id: number;
  drugName: string;
  quantity: number;
  unit: string | null;
  packageLabel?: string | null;
  packageQuantity?: number | null;
  packageUnit?: string | null;
  yakkaUnitPrice: number | null;
  yakkaValue: number | null;
}

interface ProposalItemsPanelProps {
  items: PanelItem[];
  fromName: string;
  toName: string;
  totalValue: number | null | undefined;
}

function formatQuantity(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function resolveBoxCount(item: PanelItem): number | null {
  const packageQuantity = Number(item.packageQuantity);
  if (!Number.isFinite(packageQuantity) || packageQuantity <= 0) return null;
  const boxCount = item.quantity / packageQuantity;
  return Math.abs(boxCount - Math.round(boxCount)) < 0.0001 ? Math.round(boxCount) : Math.floor(boxCount);
}

function formatPackageSize(item: PanelItem): string {
  if (!item.packageQuantity) return '-';
  return `${formatQuantity(item.packageQuantity)}${item.packageUnit || item.unit || ''}`;
}

export default function ProposalItemsPanel({ items, fromName, toName, totalValue }: ProposalItemsPanelProps) {
  return (
    <AppDataPanel
      className="mb-3"
      title={<><strong>{fromName}</strong> → <strong>{toName}</strong></>}
      actions={<Badge bg="primary">{totalValue?.toLocaleString()}円</Badge>}
    >
      <AppResponsiveSwitch
        desktop={() => (
          <div className="table-responsive">
            <AppTable size="sm" striped className="mobile-table">
              <thead><tr><th>薬品名</th><th>箱数</th><th>1箱入数</th><th>総数量</th><th>包装</th><th>薬価(合計)</th></tr></thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.drugName}</td><td>{resolveBoxCount(item) ?? '-'}</td><td>{formatPackageSize(item)}</td>
                    <td>{formatQuantity(item.quantity)}{item.unit || item.packageUnit || ''}</td><td>{item.packageLabel || '-'}</td><td>{item.yakkaValue?.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </AppTable>
          </div>
        )}
        mobile={() => (
          <div className="dl-mobile-data-list">
            {items.map((item) => (
              <AppMobileDataCard
                key={item.id}
                title={item.drugName}
                fields={[
                  { label: '箱数', value: resolveBoxCount(item) ?? '-' },
                  { label: '1箱入数', value: formatPackageSize(item) },
                  { label: '総数量', value: `${formatQuantity(item.quantity)}${item.unit || item.packageUnit || ''}` },
                  { label: '包装', value: item.packageLabel || '-' },
                  { label: '薬価(合計)', value: item.yakkaValue?.toLocaleString() ?? '-' },
                ]}
              />
            ))}
          </div>
        )}
      />
    </AppDataPanel>
  );
}
