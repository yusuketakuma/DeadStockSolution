import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { deadStockItems, exchangeProposals, exchangeProposalItems, proposalTemplates } from '../db/schema';
import { logger } from './logger';

const TEMPLATE_LIST_LIMIT = 20;

export interface TemplateItem {
  drugName: string;
  quantity: number;
}

export interface ProposalTemplate {
  id: number;
  pharmacyId: number;
  name: string;
  targetPharmacyId: number;
  items: TemplateItem[];
  createdFromProposalId: number | null;
  usageCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

function parseItemsJson(raw: string): TemplateItem[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) =>
        item !== null &&
        typeof item === 'object' &&
        typeof item.drugName === 'string' &&
        typeof item.quantity === 'number',
    );
  } catch {
    return [];
  }
}

function toProposalTemplate(row: typeof proposalTemplates.$inferSelect): ProposalTemplate {
  return {
    id: row.id,
    pharmacyId: row.pharmacyId,
    name: row.name,
    targetPharmacyId: row.targetPharmacyId,
    items: parseItemsJson(row.itemsJson),
    createdFromProposalId: row.createdFromProposalId ?? null,
    usageCount: row.usageCount,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

export async function listTemplates(pharmacyId: number): Promise<ProposalTemplate[]> {
  const rows = await db
    .select()
    .from(proposalTemplates)
    .where(eq(proposalTemplates.pharmacyId, pharmacyId))
    .orderBy(desc(proposalTemplates.usageCount), desc(proposalTemplates.updatedAt))
    .limit(TEMPLATE_LIST_LIMIT);

  return rows.map(toProposalTemplate);
}

export async function createTemplateFromProposal(
  pharmacyId: number,
  proposalId: number,
  name: string,
): Promise<ProposalTemplate> {
  // 提案が存在し、かつ完了済みであることを確認
  const [proposal] = await db
    .select({
      id: exchangeProposals.id,
      pharmacyAId: exchangeProposals.pharmacyAId,
      pharmacyBId: exchangeProposals.pharmacyBId,
      status: exchangeProposals.status,
    })
    .from(exchangeProposals)
    .where(eq(exchangeProposals.id, proposalId))
    .limit(1);

  if (!proposal) {
    throw new Error('提案が見つかりません');
  }

  if (proposal.pharmacyAId !== pharmacyId && proposal.pharmacyBId !== pharmacyId) {
    throw new Error('この提案にアクセスする権限がありません');
  }

  if (proposal.status !== 'completed') {
    throw new Error('完了済みの提案のみテンプレートとして保存できます');
  }

  // 相手先薬局IDを特定
  const targetPharmacyId =
    proposal.pharmacyAId === pharmacyId ? proposal.pharmacyBId : proposal.pharmacyAId;

  // 自分が提供した提案アイテムを薬品名付きで取得
  const enrichedItems = await db
    .select({
      drugName: deadStockItems.drugName,
      quantity: exchangeProposalItems.quantity,
    })
    .from(exchangeProposalItems)
    .innerJoin(deadStockItems, eq(exchangeProposalItems.deadStockItemId, deadStockItems.id))
    .where(
      and(
        eq(exchangeProposalItems.proposalId, proposalId),
        eq(exchangeProposalItems.fromPharmacyId, pharmacyId),
      ),
    );

  const templateItems: TemplateItem[] = enrichedItems.map((item) => ({
    drugName: item.drugName,
    quantity: item.quantity,
  }));

  const itemsJson = JSON.stringify(templateItems);

  const [inserted] = await db
    .insert(proposalTemplates)
    .values({
      pharmacyId,
      name,
      targetPharmacyId,
      itemsJson,
      createdFromProposalId: proposalId,
      usageCount: 0,
    })
    .returning();

  logger.info('Proposal template created', {
    templateId: inserted.id,
    pharmacyId,
    proposalId,
  });

  return toProposalTemplate(inserted);
}

export async function deleteTemplate(pharmacyId: number, templateId: number): Promise<void> {
  const [existing] = await db
    .select({ id: proposalTemplates.id, pharmacyId: proposalTemplates.pharmacyId })
    .from(proposalTemplates)
    .where(eq(proposalTemplates.id, templateId))
    .limit(1);

  if (!existing) {
    throw new Error('テンプレートが見つかりません');
  }

  if (existing.pharmacyId !== pharmacyId) {
    throw new Error('このテンプレートを削除する権限がありません');
  }

  await db.delete(proposalTemplates).where(eq(proposalTemplates.id, templateId));

  logger.info('Proposal template deleted', { templateId, pharmacyId });
}

export async function recordTemplateUse(
  pharmacyId: number,
  templateId: number,
): Promise<ProposalTemplate> {
  const [existing] = await db
    .select()
    .from(proposalTemplates)
    .where(eq(proposalTemplates.id, templateId))
    .limit(1);

  if (!existing) {
    throw new Error('テンプレートが見つかりません');
  }

  if (existing.pharmacyId !== pharmacyId) {
    throw new Error('このテンプレートを利用する権限がありません');
  }

  await db
    .update(proposalTemplates)
    .set({
      usageCount: sql`${proposalTemplates.usageCount} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(proposalTemplates.id, templateId));

  const [updated] = await db
    .select()
    .from(proposalTemplates)
    .where(eq(proposalTemplates.id, templateId))
    .limit(1);

  if (!updated) {
    throw new Error('テンプレート更新後の再取得に失敗しました');
  }

  return toProposalTemplate(updated);
}
