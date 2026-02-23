import { eq, and, or } from 'drizzle-orm';
import { db } from '../config/database';
import { exchangeProposals, exchangeProposalItems, exchangeHistory, deadStockItems } from '../db/schema';
import { MatchCandidate } from '../types';

export async function createProposal(
  pharmacyAId: number,
  candidate: MatchCandidate
): Promise<number> {
  const [proposal] = await db.insert(exchangeProposals).values({
    pharmacyAId,
    pharmacyBId: candidate.pharmacyId,
    status: 'proposed',
    totalValueA: candidate.totalValueA,
    totalValueB: candidate.totalValueB,
    valueDifference: candidate.valueDifference,
  }).returning({ id: exchangeProposals.id });

  // Insert proposal items - A to B
  for (const item of candidate.itemsFromA) {
    await db.insert(exchangeProposalItems).values({
      proposalId: proposal.id,
      deadStockItemId: item.deadStockItemId,
      fromPharmacyId: pharmacyAId,
      toPharmacyId: candidate.pharmacyId,
      quantity: item.quantity,
      yakkaValue: item.yakkaValue,
    });
  }

  // Insert proposal items - B to A
  for (const item of candidate.itemsFromB) {
    await db.insert(exchangeProposalItems).values({
      proposalId: proposal.id,
      deadStockItemId: item.deadStockItemId,
      fromPharmacyId: candidate.pharmacyId,
      toPharmacyId: pharmacyAId,
      quantity: item.quantity,
      yakkaValue: item.yakkaValue,
    });
  }

  return proposal.id;
}

export async function acceptProposal(proposalId: number, pharmacyId: number): Promise<string> {
  const [proposal] = await db.select()
    .from(exchangeProposals)
    .where(eq(exchangeProposals.id, proposalId))
    .limit(1);

  if (!proposal) throw new Error('提案が見つかりません');

  const isA = proposal.pharmacyAId === pharmacyId;
  const isB = proposal.pharmacyBId === pharmacyId;
  if (!isA && !isB) throw new Error('この提案にアクセスする権限がありません');

  let newStatus: string;

  if (proposal.status === 'proposed') {
    newStatus = isA ? 'accepted_a' : 'accepted_b';
  } else if (proposal.status === 'accepted_a' && isB) {
    newStatus = 'confirmed';
  } else if (proposal.status === 'accepted_b' && isA) {
    newStatus = 'confirmed';
  } else {
    throw new Error('この提案は現在承認できる状態ではありません');
  }

  await db.update(exchangeProposals)
    .set({ status: newStatus as typeof proposal.status })
    .where(eq(exchangeProposals.id, proposalId));

  return newStatus;
}

export async function rejectProposal(proposalId: number, pharmacyId: number): Promise<void> {
  const [proposal] = await db.select()
    .from(exchangeProposals)
    .where(eq(exchangeProposals.id, proposalId))
    .limit(1);

  if (!proposal) throw new Error('提案が見つかりません');

  const isParty = proposal.pharmacyAId === pharmacyId || proposal.pharmacyBId === pharmacyId;
  if (!isParty) throw new Error('この提案にアクセスする権限がありません');

  await db.update(exchangeProposals)
    .set({ status: 'rejected' })
    .where(eq(exchangeProposals.id, proposalId));
}

export async function completeProposal(proposalId: number, pharmacyId: number): Promise<void> {
  const [proposal] = await db.select()
    .from(exchangeProposals)
    .where(eq(exchangeProposals.id, proposalId))
    .limit(1);

  if (!proposal) throw new Error('提案が見つかりません');
  if (proposal.status !== 'confirmed') throw new Error('この提案はまだ確定されていません');

  const isParty = proposal.pharmacyAId === pharmacyId || proposal.pharmacyBId === pharmacyId;
  if (!isParty) throw new Error('この提案にアクセスする権限がありません');

  const completedAt = new Date().toISOString();

  await db.update(exchangeProposals)
    .set({ status: 'completed', completedAt })
    .where(eq(exchangeProposals.id, proposalId));

  // Mark exchanged dead stock items as unavailable
  const items = await db.select()
    .from(exchangeProposalItems)
    .where(eq(exchangeProposalItems.proposalId, proposalId));

  for (const item of items) {
    await db.update(deadStockItems)
      .set({ isAvailable: false })
      .where(eq(deadStockItems.id, item.deadStockItemId));
  }

  // Create exchange history
  const totalValue = (proposal.totalValueA ?? 0) + (proposal.totalValueB ?? 0);
  await db.insert(exchangeHistory).values({
    proposalId,
    pharmacyAId: proposal.pharmacyAId,
    pharmacyBId: proposal.pharmacyBId,
    totalValue,
    completedAt,
  });
}
