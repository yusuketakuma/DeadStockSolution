import { useCallback, useEffect, useState } from 'react';
import {
  compareProposalTemplates,
  listProposalTemplates,
  markProposalTemplateUsed,
  type ProposalTemplate,
} from '../../api/proposal-templates';
import ProposalTemplatePanel from '../proposal/ProposalTemplatePanel';

interface ProposalTemplateSelectorProps {
  onUseMessage: (message: string) => void;
}

export default function ProposalTemplateSelector({
  onUseMessage,
}: ProposalTemplateSelectorProps) {
  const [templates, setTemplates] = useState<ProposalTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    let mounted = true;

    async function loadTemplates() {
      setLoading(true);
      setStatusMessage('');
      try {
        const nextTemplates = await listProposalTemplates();
        if (!mounted) return;
        setTemplates(nextTemplates.sort(compareProposalTemplates));
      } catch {
        if (!mounted) return;
        setTemplates([]);
        setStatusMessage('テンプレートは現在読み込めません。候補検索はそのまま利用できます。');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void loadTemplates();
    return () => {
      mounted = false;
    };
  }, []);

  const buildTemplateMatchingPath = useCallback((template: ProposalTemplate) => {
    const params = new URLSearchParams();
    params.set('targetPharmacyId', String(template.targetPharmacyId));
    const itemTerms = template.items.map((item) => item.drugName.trim()).filter(Boolean).slice(0, 5);
    if (itemTerms.length > 0) {
      params.set('inventorySearchDrugs', itemTerms.join('/'));
    }
    return `/matching?${params.toString()}`;
  }, []);

  const handleUseTemplate = useCallback((template: ProposalTemplate) => {
    onUseMessage(`テンプレート「${template.name}」の条件で候補を確認します。`);
    void markProposalTemplateUsed(template.id)
      .then((updatedTemplate) => {
        setTemplates((prev) => prev
          .map((current) => (current.id === updatedTemplate.id ? updatedTemplate : current))
          .sort(compareProposalTemplates));
      })
      .catch(() => {});
  }, [onUseMessage]);

  return (
    <ProposalTemplatePanel
      title="保存済み提案テンプレート"
      templates={templates}
      loading={loading}
      buildUseTo={buildTemplateMatchingPath}
      useLabel="この条件で候補を探す"
      emptyMessage={statusMessage || '完了済み提案をテンプレート保存すると、交換先や品目を絞って再検索できます。'}
      onUse={handleUseTemplate}
    />
  );
}
