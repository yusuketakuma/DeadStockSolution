import { type TestDb } from './test-db';
import * as schema from '../../../db/schema';

let seqCounter = 0;
function nextSeq(): number {
  return ++seqCounter;
}

export function resetFactorySeq(): void {
  seqCounter = 0;
}

export async function makePharmacy(
  db: TestDb,
  overrides: Partial<typeof schema.pharmacies.$inferInsert> = {},
): Promise<typeof schema.pharmacies.$inferSelect> {
  const seq = nextSeq();
  const defaults: typeof schema.pharmacies.$inferInsert = {
    email: `pharmacy${seq}@example.com`,
    passwordHash: '$2b$10$dummyhashvalue000000000000000000000000000000',
    name: `テスト薬局${seq}`,
    postalCode: `100000${seq % 10}`,
    address: `東京都千代田区テスト${seq}`,
    phone: `03-0000-${String(seq).padStart(4, '0')}`,
    fax: `03-0001-${String(seq).padStart(4, '0')}`,
    licenseNumber: `T${String(seq).padStart(6, '0')}`,
    prefecture: '東京都',
    verificationStatus: 'verified',
    ...overrides,
  };
  const [row] = await db.insert(schema.pharmacies).values(defaults).returning();
  return row;
}

export async function makeUpload(
  db: TestDb,
  pharmacyId: number,
  overrides: Partial<typeof schema.uploads.$inferInsert> = {},
): Promise<typeof schema.uploads.$inferSelect> {
  const defaults: typeof schema.uploads.$inferInsert = {
    pharmacyId,
    uploadType: 'dead_stock',
    originalFilename: 'test.csv',
    ...overrides,
  };
  const [row] = await db.insert(schema.uploads).values(defaults).returning();
  return row;
}

export async function makeDeadStockItem(
  db: TestDb,
  pharmacyId: number,
  uploadId: number,
  overrides: Partial<typeof schema.deadStockItems.$inferInsert> = {},
): Promise<typeof schema.deadStockItems.$inferSelect> {
  const seq = nextSeq();
  const defaults: typeof schema.deadStockItems.$inferInsert = {
    pharmacyId,
    uploadId,
    drugName: `テスト薬品${seq}`,
    quantity: 10,
    ...overrides,
  };
  const [row] = await db.insert(schema.deadStockItems).values(defaults).returning();
  return row;
}

export async function makeDrugMaster(
  db: TestDb,
  overrides: Partial<typeof schema.drugMaster.$inferInsert> = {},
): Promise<typeof schema.drugMaster.$inferSelect> {
  const seq = nextSeq();
  const defaults: typeof schema.drugMaster.$inferInsert = {
    yjCode: `${String(seq).padStart(4, '0')}000000`,
    drugName: `テスト医薬品${seq}`,
    yakkaPrice: '100.00',
    ...overrides,
  };
  const [row] = await db.insert(schema.drugMaster).values(defaults).returning();
  return row;
}

export async function makeExchangeProposal(
  db: TestDb,
  pharmacyAId: number,
  pharmacyBId: number,
  overrides: Partial<typeof schema.exchangeProposals.$inferInsert> = {},
): Promise<typeof schema.exchangeProposals.$inferSelect> {
  const defaults: typeof schema.exchangeProposals.$inferInsert = {
    pharmacyAId,
    pharmacyBId,
    ...overrides,
  };
  const [row] = await db.insert(schema.exchangeProposals).values(defaults).returning();
  return row;
}

export async function makeExchangeProposalItem(
  db: TestDb,
  proposalId: number,
  deadStockItemId: number,
  fromPharmacyId: number,
  toPharmacyId: number,
  overrides: Partial<typeof schema.exchangeProposalItems.$inferInsert> = {},
): Promise<typeof schema.exchangeProposalItems.$inferSelect> {
  const defaults: typeof schema.exchangeProposalItems.$inferInsert = {
    proposalId,
    deadStockItemId,
    fromPharmacyId,
    toPharmacyId,
    quantity: 5,
    ...overrides,
  };
  const [row] = await db.insert(schema.exchangeProposalItems).values(defaults).returning();
  return row;
}

export async function makeNotification(
  db: TestDb,
  pharmacyId: number,
  overrides: Partial<typeof schema.notifications.$inferInsert> = {},
): Promise<typeof schema.notifications.$inferSelect> {
  const seq = nextSeq();
  const defaults: typeof schema.notifications.$inferInsert = {
    pharmacyId,
    type: 'proposal_received',
    title: `通知${seq}`,
    message: `テスト通知メッセージ${seq}`,
    ...overrides,
  };
  const [row] = await db.insert(schema.notifications).values(defaults).returning();
  return row;
}

export async function makeActivityLog(
  db: TestDb,
  overrides: Partial<typeof schema.activityLogs.$inferInsert> = {},
): Promise<typeof schema.activityLogs.$inferSelect> {
  const defaults: typeof schema.activityLogs.$inferInsert = {
    action: 'test_action',
    detail: 'テスト詳細',
    ...overrides,
  };
  const [row] = await db.insert(schema.activityLogs).values(defaults).returning();
  return row;
}

export async function makeMatchCandidateSnapshot(
  db: TestDb,
  pharmacyId: number,
  overrides: Partial<typeof schema.matchCandidateSnapshots.$inferInsert> = {},
): Promise<typeof schema.matchCandidateSnapshots.$inferSelect> {
  const defaults: typeof schema.matchCandidateSnapshots.$inferInsert = {
    pharmacyId,
    candidateHash: 'test-hash',
    candidateCount: 0,
    topCandidatesJson: '[]',
    ...overrides,
  };
  const [row] = await db.insert(schema.matchCandidateSnapshots).values(defaults).returning();
  return row;
}
