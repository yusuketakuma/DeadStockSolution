import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { createDatabase, db, getDatabase, isRequestScopedDatabase, runWithDatabase } from '../config/database';

function createPoolStub(): Pool {
  return { query: async () => ({ rows: [] }) } as unknown as Pool;
}

describe('request-scoped database', () => {
  it('uses the shared database outside of a request scope', () => {
    expect(isRequestScopedDatabase()).toBe(false);
    expect(getDatabase()).toBe(getDatabase());
  });

  it('routes the db proxy to the database bound for the current request', async () => {
    const poolA = createPoolStub();
    const poolB = createPoolStub();
    const databaseA = createDatabase(poolA);
    const databaseB = createDatabase(poolB);

    const [seenA, seenB] = await Promise.all([
      runWithDatabase(databaseA, async () => {
        await Promise.resolve();
        return { scoped: isRequestScopedDatabase(), client: db.$client, current: getDatabase() };
      }),
      runWithDatabase(databaseB, async () => ({ scoped: isRequestScopedDatabase(), client: db.$client, current: getDatabase() })),
    ]);

    expect(seenA).toEqual({ scoped: true, client: poolA, current: databaseA });
    expect(seenB).toEqual({ scoped: true, client: poolB, current: databaseB });
    expect(isRequestScopedDatabase()).toBe(false);
  });

  it('binds proxied methods to the scoped database', () => {
    const database = createDatabase(createPoolStub());
    runWithDatabase(database, () => {
      const { select } = db;
      expect(() => select().from).not.toThrow();
    });
  });
});
