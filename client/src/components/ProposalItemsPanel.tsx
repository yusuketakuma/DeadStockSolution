import { Badge } from 'react-bootstrap';
import AppDataPanel from './ui/AppDataPanel';
import AppTable from './ui/AppTable';
import AppMobileDataCard from './ui/AppMobileDataCard';
import AppResponsiveSwitch from './ui/AppResponsiveSwitch';
import { formatBoxCount, formatPackageSize, formatTotalQuantity } from '../utils/package-display';

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
                    <td>{item.drugName}</td><td>{formatBoxCount(item)}</td><td>{formatPackageSize(item)}</td>
                    <td>{formatTotalQuantity(item)}</td><td>{item.packageLabel || '-'}</td><td>{item.yakkaValue?.toLocaleString()}</td>
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
                  { label: '箱数', value: formatBoxCount(item) },
                  { label: '1箱入数', value: formatPackageSize(item) },
                  { label: '総数量', value: formatTotalQuantity(item) },
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
