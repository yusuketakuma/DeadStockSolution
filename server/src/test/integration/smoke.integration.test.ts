import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getTestDb, resetTestDb, closeTestDb, type TestDb } from './helpers/test-db';
import { makePharmacy, resetFactorySeq } from './helpers/factories';

let db: TestDb;

beforeAll(async () => {
  db = await getTestDb();
}, 30_000);

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  resetFactorySeq();
});

describe('PGlite integration smoke test', () => {
  it('creates and reads a pharmacy record', async () => {
    const pharmacy = await makePharmacy(db, { name: 'テスト薬局A' });
    expect(pharmacy.id).toBe(1);
    expect(pharmacy.name).toBe('テスト薬局A');
    expect(pharmacy.prefecture).toBe('東京都');
  });

  it('resets DB between tests', async () => {
    const pharmacy = await makePharmacy(db);
    expect(pharmacy.id).toBe(1);
  });

  it('creates multiple pharmacies with unique sequences', async () => {
    const a = await makePharmacy(db);
    const b = await makePharmacy(db);
    expect(a.id).not.toBe(b.id);
    expect(a.email).not.toBe(b.email);
  });
});
