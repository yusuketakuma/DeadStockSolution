import { api } from './client';

export interface ProposalTemplateItem {
  drugName: string;
  quantity: number;
}

export interface ProposalTemplate {
  id: number;
  pharmacyId: number;
  name: string;
  targetPharmacyId: number;
  items: ProposalTemplateItem[];
  createdFromProposalId: number | null;
  usageCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export function compareProposalTemplates(a: ProposalTemplate, b: ProposalTemplate): number {
  if (a.usageCount !== b.usageCount) {
    return b.usageCount - a.usageCount;
  }

  const aUpdatedAt = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
  const bUpdatedAt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
  return bUpdatedAt - aUpdatedAt;
}

export function listProposalTemplates(signal?: AbortSignal): Promise<ProposalTemplate[]> {
  return api.get<ProposalTemplate[]>('/proposal-templates', { signal });
}

export function createProposalTemplate(
  proposalId: number,
  name: string,
): Promise<ProposalTemplate> {
  return api.post<ProposalTemplate>('/proposal-templates', {
    proposalId,
    name,
  });
}

export function deleteProposalTemplate(templateId: number): Promise<void> {
  return api.delete<void>(`/proposal-templates/${templateId}`);
}

export function markProposalTemplateUsed(templateId: number): Promise<ProposalTemplate> {
  return api.post<ProposalTemplate>(`/proposal-templates/${templateId}/use`);
}
