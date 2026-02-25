import { Badge, Button, Spinner, Table } from 'react-bootstrap';
import Pagination from '../../../components/Pagination';

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
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onOpenDetail: (yjCode: string) => void;
  onOpenEdit: (yjCode: string) => void;
}

export default function DrugMasterTable({
  items,
  loading,
  totalItems,
  page,
  totalPages,
  onPageChange,
  onOpenDetail,
  onOpenEdit,
}: DrugMasterTableProps) {
  if (loading) {
    return (
      <div className="text-center py-4">
        <Spinner><span className="visually-hidden">読み込み中...</span></Spinner>
      </div>
    );
  }

  return (
    <>
      <div className="table-responsive">
        <Table striped hover size="sm" className="mobile-table">
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
                  <button
                    type="button"
                    className="btn btn-link p-0 text-start text-decoration-none"
                    onClick={() => onOpenDetail(item.yjCode)}
                  >
                    {item.drugName}
                  </button>
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
                  <Button size="sm" variant="outline-secondary" onClick={() => onOpenEdit(item.yjCode)}>
                    編集
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      <Pagination currentPage={page} totalPages={totalPages} onPageChange={onPageChange} />
    </>
  );
}
