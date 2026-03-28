import { Router, Response } from 'express';
import { and, eq, inArray, or } from 'drizzle-orm';
import { db } from '../config/database';
import {
  deadStockItems,
  deadStockReservations,
  exchangeProposalItems,
  exchangeProposals,
  notifications,
  pharmacies,
  uploadJobs,
  usedMedicationItems,
} from '../db/schema';
import { findMatches } from '../services/matching-service';
import { logger } from '../services/logger';

const router = Router();

interface TestAccountRow {
  id: number;
  name: string;
  email: string;
  prefecture: string;
}

function isEnabled(): boolean {
  return process.env.NODE_ENV !== 'production';
}

function isAuthorized(req: { headers: Record<string, unknown> }): boolean {
  const secret = process.env.E2E_HELPER_SECRET?.trim();
  if (!secret) {
    return true;
  }
  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  return authHeader === `Bearer ${secret}`;
}

async function loadTestAccounts(): Promise<TestAccountRow[]> {
  return db.select({
    id: pharmacies.id,
    name: pharmacies.name,
    email: pharmacies.email,
    prefecture: pharmacies.prefecture,
  })
    .from(pharmacies)
    .where(eq(pharmacies.isTestAccount, true))
    .orderBy(pharmacies.id);
}

async function resetFixtureData(pharmacyIds: number[]): Promise<void> {
  const proposalRows = await db.select({ id: exchangeProposals.id })
    .from(exchangeProposals)
    .where(or(
      inArray(exchangeProposals.pharmacyAId, pharmacyIds),
      inArray(exchangeProposals.pharmacyBId, pharmacyIds),
    ));
  const proposalIds = proposalRows.map((row) => row.id);

  if (proposalIds.length > 0) {
    await db.delete(deadStockReservations)
      .where(inArray(deadStockReservations.proposalId, proposalIds));
    await db.delete(exchangeProposalItems)
      .where(inArray(exchangeProposalItems.proposalId, proposalIds));
    await db.delete(exchangeProposals)
      .where(inArray(exchangeProposals.id, proposalIds));
  }

  await db.delete(notifications)
    .where(inArray(notifications.pharmacyId, pharmacyIds));
  await db.delete(usedMedicationItems)
    .where(inArray(usedMedicationItems.pharmacyId, pharmacyIds));
  await db.delete(deadStockItems)
    .where(inArray(deadStockItems.pharmacyId, pharmacyIds));
  await db.delete(uploadJobs)
    .where(inArray(uploadJobs.pharmacyId, pharmacyIds));
}

async function insertUpload(pharmacyId: number, uploadType: 'dead_stock' | 'used_medication') {
  const [row] = await db.insert(uploadJobs).values({
    pharmacyId,
    uploadType,
    originalFilename: `${uploadType}.csv`,
    fileHash: `${uploadType}-${pharmacyId}-${Date.now()}`,
    headerRowIndex: 1,
    mappingJson: { drugName: 'drug_name' },
    fileBase64: 'Zml4dHVyZQ==',
    status: 'completed',
    completedAt: new Date().toISOString(),
  }).returning({ id: uploadJobs.id });
  return row.id;
}

router.post('/seed', async (req, res: Response) => {
  try {
    if (!isEnabled()) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (!isAuthorized(req)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const actorIndex = Number(req.body?.actorIndex ?? 0);
    const counterpartyIndex = Number(req.body?.counterpartyIndex ?? 1);

    const accounts = await loadTestAccounts();
    if (accounts.length <= Math.max(actorIndex, counterpartyIndex)) {
      res.status(503).json({ error: 'test pharmacy accounts are not ready' });
      return;
    }

    const actor = accounts[actorIndex]!;
    const counterparty = accounts[counterpartyIndex]!;
    const pharmacyIds = [actor.id, counterparty.id];
    await resetFixtureData(pharmacyIds);

    const actorDeadUploadId = await insertUpload(actor.id, 'dead_stock');
    const actorUsedUploadId = await insertUpload(actor.id, 'used_medication');
    const counterpartyDeadUploadId = await insertUpload(counterparty.id, 'dead_stock');
    const counterpartyUsedUploadId = await insertUpload(counterparty.id, 'used_medication');

    const [actorDeadStock] = await db.insert(deadStockItems).values({
      pharmacyId: actor.id,
      uploadId: actorDeadUploadId,
      drugCode: 'E2E-DRUG-A',
      drugName: 'テスト薬A',
      quantity: 10,
      unit: '錠',
      yakkaUnitPrice: '100',
      yakkaTotal: '1000',
      expirationDate: '2026-06-30',
      expirationDateIso: '2026-06-30',
      lotNumber: 'LOT-A',
      isAvailable: true,
    }).returning({ id: deadStockItems.id });

    const [counterpartyDeadStock] = await db.insert(deadStockItems).values({
      pharmacyId: counterparty.id,
      uploadId: counterpartyDeadUploadId,
      drugCode: 'E2E-DRUG-B',
      drugName: 'テスト薬B',
      quantity: 10,
      unit: '錠',
      yakkaUnitPrice: '100',
      yakkaTotal: '1000',
      expirationDate: '2026-07-31',
      expirationDateIso: '2026-07-31',
      lotNumber: 'LOT-B',
      isAvailable: true,
    }).returning({ id: deadStockItems.id });

    await db.insert(usedMedicationItems).values([
      {
        pharmacyId: actor.id,
        uploadId: actorUsedUploadId,
        drugCode: 'E2E-DRUG-B',
        drugName: 'テスト薬B',
        monthlyUsage: 20,
        unit: '錠',
        yakkaUnitPrice: '100',
      },
      {
        pharmacyId: counterparty.id,
        uploadId: counterpartyUsedUploadId,
        drugCode: 'E2E-DRUG-A',
        drugName: 'テスト薬A',
        monthlyUsage: 20,
        unit: '錠',
        yakkaUnitPrice: '100',
      },
    ]);

    const candidates = await findMatches(actor.id);
    const candidate = candidates.find((row) => row.pharmacyId === counterparty.id) ?? null;
    if (!candidate) {
      res.status(500).json({ error: 'fixture seeded but matching candidate was not created' });
      return;
    }

    res.json({
      actor,
      counterparty,
      candidate,
      stockIds: {
        actorDeadStockId: actorDeadStock.id,
        counterpartyDeadStockId: counterpartyDeadStock.id,
      },
    });
  } catch (error) {
    logger.error('E2E proposal seed failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'e2e seed failed' });
  }
});

router.post('/deplete', async (req, res: Response) => {
  try {
    if (!isEnabled()) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (!isAuthorized(req)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const deadStockItemId = Number(req.body?.deadStockItemId);
    const quantity = Number(req.body?.quantity ?? 0);
    const isAvailable = req.body?.isAvailable !== false ? false : false;
    if (!Number.isInteger(deadStockItemId) || deadStockItemId <= 0) {
      res.status(400).json({ error: 'deadStockItemId is required' });
      return;
    }

    const [updated] = await db.update(deadStockItems)
      .set({
        quantity: Number.isFinite(quantity) && quantity >= 0 ? quantity : 0,
        isAvailable,
      })
      .where(eq(deadStockItems.id, deadStockItemId))
      .returning({ id: deadStockItems.id, quantity: deadStockItems.quantity, isAvailable: deadStockItems.isAvailable });

    if (!updated) {
      res.status(404).json({ error: 'stock item not found' });
      return;
    }

    res.json({ item: updated });
  } catch (error) {
    logger.error('E2E proposal stock depletion failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'e2e stock depletion failed' });
  }
});

export default router;
