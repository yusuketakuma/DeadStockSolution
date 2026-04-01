import LoadingButton from '../../components/ui/LoadingButton';
import ProposalTemplatePanel from '../../components/proposal/ProposalTemplatePanel';
import type { ProposalTemplate } from '../../api/proposal-templates';
import type { ReactNode } from 'react';

interface ProposalTemplateSaveSectionProps {
  templates: ProposalTemplate[];
  templatesLoading: boolean;
  templateError: string;
  deletingTemplateId: number | null;
  canSaveTemplate: boolean;
  templateName: string;
  templateSaving: boolean;
  onTemplateNameChange: (value: string) => void;
  onCreateTemplate: () => void;
  onDeleteTemplate: (templateId: number) => void;
  buildUseTo: (template: ProposalTemplate) => string;
  onUseTemplate: (template: ProposalTemplate) => void;
}

export function ProposalTemplateSaveSection({
  templates,
  templatesLoading,
  templateError,
  deletingTemplateId,
  canSaveTemplate,
  templateName,
  templateSaving,
  onTemplateNameChange,
  onCreateTemplate,
  onDeleteTemplate,
  buildUseTo,
  onUseTemplate,
}: ProposalTemplateSaveSectionProps) {
  const actions: ReactNode | null = canSaveTemplate ? (
    <div className="d-flex gap-2 flex-wrap">
      <input
        value={templateName}
        onChange={(event) => onTemplateNameChange(event.target.value)}
        className="form-control form-control-sm"
        style={{ minWidth: 220 }}
        placeholder="テンプレート名"
        maxLength={100}
      />
      <LoadingButton
        type="button"
        size="sm"
        variant="primary"
        loading={templateSaving}
        loadingLabel="保存中..."
        onClick={onCreateTemplate}
      >
        この提案を保存
      </LoadingButton>
    </div>
  ) : null;

  return (
    <ProposalTemplatePanel
      title="提案テンプレート"
      templates={templates}
      loading={templatesLoading}
      error={templateError}
      deletingTemplateId={deletingTemplateId}
      onDelete={onDeleteTemplate}
      buildUseTo={buildUseTo}
      onUse={onUseTemplate}
      actions={actions}
      emptyMessage={canSaveTemplate
        ? '完了済み提案をテンプレートとして保存すると、次回の候補検索に再利用できます。'
        : '保存済みテンプレートはありません。完了済み提案から保存できます。'}
    />
  );
}
