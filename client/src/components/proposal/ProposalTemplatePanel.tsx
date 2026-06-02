import { Badge } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import type { ProposalTemplate } from '../../api/proposal-templates';
import AppAlert from '../ui/AppAlert';
import AppDataPanel from '../ui/AppDataPanel';
import AppDropdownMenu from '../ui/AppDropdownMenu';
import { formatDateTimeJa } from '../../utils/formatters';

interface ProposalTemplatePanelProps {
  title?: React.ReactNode;
  templates: ProposalTemplate[];
  loading?: boolean;
  error?: string;
  emptyMessage?: string;
  actions?: React.ReactNode;
  deletingTemplateId?: number | null;
  onDelete?: (templateId: number) => void;
  buildUseTo: (template: ProposalTemplate) => string;
  onUse?: (template: ProposalTemplate) => void;
  useLabel?: string;
}

function summarizeTemplateItems(template: ProposalTemplate): string {
  if (template.items.length === 0) {
    return '品目情報なし';
  }

  return template.items
    .slice(0, 3)
    .map((item) => `${item.drugName} ${item.quantity}`)
    .join(' / ');
}

export default function ProposalTemplatePanel({
  title = '提案テンプレート',
  templates,
  loading = false,
  error = '',
  emptyMessage = '保存済みテンプレートはありません。',
  actions,
  deletingTemplateId = null,
  onDelete,
  buildUseTo,
  onUse,
  useLabel = '候補を探す',
}: ProposalTemplatePanelProps) {
  return (
    <AppDataPanel title={title} actions={actions} className="mb-3" bodyClassName="small">
      {error && <AppAlert variant="danger" className="mb-3">{error}</AppAlert>}
      {loading ? (
        <div className="text-muted">テンプレートを読み込み中...</div>
      ) : templates.length === 0 ? (
        <div className="text-muted">{emptyMessage}</div>
      ) : (
        <div className="d-flex flex-column gap-2">
          {templates.map((template) => (
            <div key={template.id} className="border rounded p-2">
              <div className="d-flex justify-content-between align-items-start gap-2 flex-wrap">
                <div>
                  <div className="fw-semibold">{template.name}</div>
                  <div className="text-muted">
                    {summarizeTemplateItems(template)}
                  </div>
                </div>
                <div className="dl-action-row mobile-stack align-items-center">
                  <Badge bg="secondary">{template.items.length}品目</Badge>
                  <Badge bg="light" text="dark">使用 {template.usageCount}回</Badge>
                </div>
              </div>
              <div className="d-flex justify-content-between align-items-center gap-2 flex-wrap mt-2">
                <div className="text-muted">
                  更新: {formatDateTimeJa(template.updatedAt ?? template.createdAt)}
                </div>
                <div className="dl-action-row mobile-stack">
                  <Link
                    to={buildUseTo(template)}
                    className="btn btn-sm btn-primary"
                    onClick={() => onUse?.(template)}
                  >
                    {useLabel}
                  </Link>
                  {onDelete ? (
                    <AppDropdownMenu
                      label="その他"
                      variant="outline-secondary"
                      items={[
                        {
                          key: 'delete',
                          label: deletingTemplateId === template.id ? '削除中...' : '削除',
                          onClick: () => onDelete(template.id),
                          disabled: deletingTemplateId === template.id,
                          danger: true,
                        },
                      ]}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppDataPanel>
  );
}
