import { Badge } from 'react-bootstrap';
import AppTable from '../../../components/ui/AppTable';
import AppButton from '../../../components/ui/AppButton';
import InlineLoader from '../../../components/ui/InlineLoader';
import AppMobileDataCard from '../../../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../../../components/ui/AppResponsiveSwitch';

interface DrugMasterItem {
  id: number;
  yjCode: string;
  drugName: string;
  genericName: string | null;
  specification: string | null;
  unit: string | null;
  yakkaPrice: number;
  manufacturer: string | null;
  isListed: boolean;
  transitionDeadline: string | null;
}

interface DrugMasterTableProps {
  items: DrugMasterItem[];
  loading: boolean;
  totalItems: number | undefined;
  onOpenDetail: (yjCode: string) => void;
  onOpenEdit: (yjCode: string) => void;
}

export default function DrugMasterTable({
  items,
  loading,
  totalItems,
  onOpenDetail,
  onOpenEdit,
}: DrugMasterTableProps) {
  if (loading) {
    return (
      <div className="text-center py-4">
        <InlineLoader text="読み込み中..." />
      </div>
    );
  }

  return (
    <>
      <AppResponsiveSwitch
        desktop={() => (
          <div className="table-responsive">
            <AppTable striped hover size="sm" className="mobile-table">
              <thead>
                <tr>
                  <th>YJコード</th>
                  <th>品名</th>
                  <th>成分名</th>
                  <th>規格</th>
                  <th className="text-end">薬価</th>
                  <th>単位</th>
                  <th>メーカー</th>
                  <th>状態</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center text-muted py-4">
                      {totalItems === 0
                        ? '医薬品マスターにデータがありません。薬価基準収載品目リストを同期してください。'
                        : '該当する医薬品が見つかりません。'}
                    </td>
                  </tr>
                ) : items.map((item) => (
                  <tr key={item.id}>
                    <td className="small font-monospace">{item.yjCode}</td>
                    <td>
                      <AppButton
                        type="button"
                        variant="link"
                        className="p-0 text-start text-decoration-none"
                        onClick={() => onOpenDetail(item.yjCode)}
                      >
                        {item.drugName}
                      </AppButton>
                    </td>
                    <td className="small">{item.genericName || '-'}</td>
                    <td className="small">{item.specification || '-'}</td>
                    <td className="text-end">{item.yakkaPrice.toLocaleString()}</td>
                    <td className="small">{item.unit || '-'}</td>
                    <td className="small">{item.manufacturer || '-'}</td>
                    <td>
                      {item.isListed ? (
                        item.transitionDeadline
                          ? <Badge bg="warning" text="dark">経過措置</Badge>
                          : <Badge bg="success">収載中</Badge>
                      ) : (
                        <Badge bg="secondary">削除済</Badge>
                      )}
                    </td>
                    <td>
                      <AppButton size="sm" variant="outline-secondary" onClick={() => onOpenEdit(item.yjCode)}>
                        編集
                      </AppButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </AppTable>
          </div>
        )}
        mobile={() => (
          <div className="dl-mobile-data-list">
            {items.length === 0 ? (
              <AppMobileDataCard
                title="医薬品マスター"
                fields={[
                  {
                    label: '状態',
                    value: totalItems === 0
                      ? 'データがありません。薬価基準収載品目リストを同期してください。'
                      : '該当する医薬品が見つかりません。',
                  },
                ]}
              />
            ) : items.map((item) => (
              <AppMobileDataCard
                key={item.id}
                title={item.drugName}
                subtitle={item.yjCode}
                badges={item.isListed
                  ? (item.transitionDeadline
                    ? <Badge bg="warning" text="dark">経過措置</Badge>
                    : <Badge bg="success">収載中</Badge>)
                  : <Badge bg="secondary">削除済</Badge>}
                fields={[
                  { label: '成分名', value: item.genericName || '-' },
                  { label: '規格', value: item.specification || '-' },
                  { label: '薬価', value: item.yakkaPrice.toLocaleString() },
                  { label: '単位', value: item.unit || '-' },
                  { label: 'メーカー', value: item.manufacturer || '-' },
                ]}
                actions={(
                  <>
                    <AppButton size="sm" variant="outline-primary" onClick={() => onOpenDetail(item.yjCode)}>
                      詳細
                    </AppButton>
                    <AppButton size="sm" variant="outline-secondary" onClick={() => onOpenEdit(item.yjCode)}>
                      編集
                    </AppButton>
                  </>
                )}
              />
            ))}
          </div>
        )}
      />
    </>
  );
}
