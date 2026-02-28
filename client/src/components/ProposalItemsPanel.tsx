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
              <thead><tr><th>薬品名</th><th>数量</th><th>単位</th><th>薬価(単価)</th><th>薬価(合計)</th></tr></thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.drugName}</td><td>{item.quantity}</td><td>{item.unit}</td>
                    <td>{item.yakkaUnitPrice?.toLocaleString()}</td><td>{item.yakkaValue?.toLocaleString()}</td>
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
                  { label: '数量', value: item.quantity },
                  { label: '単位', value: item.unit || '-' },
                  { label: '薬価(単価)', value: item.yakkaUnitPrice?.toLocaleString() ?? '-' },
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
