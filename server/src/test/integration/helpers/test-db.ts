import { PGlite } from '@electric-sql/pglite';
// @ts-expect-error — contrib types may not be shipped
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import * as schema from '../../../db/schema';
import fs from 'node:fs';
import path from 'node:path';

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let client: PGlite | null = null;
let db: TestDb | null = null;
let initPromise: Promise<TestDb> | null = null;
let snapshotCache: Snapshot | null = null;
let resetTableNamesCache: string[] | null = null;

/* ------------------------------------------------------------------ */
/*  Snapshot types                                                     */
/* ------------------------------------------------------------------ */

interface SnapshotColumn {
  name: string;
  type: string;
  primaryKey: boolean;
  notNull: boolean;
  default?: string | number | boolean;
}

interface SnapshotIndex {
  name: string;
  columns: Array<{
    expression: string;
    isExpression: boolean;
    asc: boolean;
    nulls: string;
  }>;
  isUnique: boolean;
  method: string;
  where?: string;
}

interface SnapshotForeignKey {
  name: string;
  tableFrom: string;
  tableTo: string;
  columnsFrom: string[];
  columnsTo: string[];
  onDelete: string;
  onUpdate: string;
}

interface SnapshotTable {
  name: string;
  columns: Record<string, SnapshotColumn>;
  indexes: Record<string, SnapshotIndex>;
  foreignKeys: Record<string, SnapshotForeignKey>;
  uniqueConstraints: Record<string, { name: string; columns: string[] }>;
  checkConstraints: Record<string, { name: string; value: string }>;
}

interface SnapshotEnum {
  name: string;
  values: string[];
}

interface Snapshot {
  tables: Record<string, SnapshotTable>;
  enums: Record<string, SnapshotEnum>;
}

/* ------------------------------------------------------------------ */
/*  Read the latest Drizzle snapshot                                   */
/* ------------------------------------------------------------------ */

const DRIZZLE_DIR = path.resolve(__dirname, '../../../../drizzle');

function getLatestSnapshot(): Snapshot {
  if (snapshotCache) return snapshotCache;

  const journalPath = path.join(DRIZZLE_DIR, 'meta', '_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8')) as {
    entries: Array<{ idx: number; tag: string }>;
  };

  const sorted = [...journal.entries].sort((a, b) => b.idx - a.idx);
  for (const entry of sorted) {
    const snapshotPath = path.join(
      DRIZZLE_DIR,
      'meta',
      `${String(entry.idx).padStart(4, '0')}_snapshot.json`,
    );
    if (fs.existsSync(snapshotPath)) {
      snapshotCache = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')) as Snapshot;
      return snapshotCache;
    }
  }
  throw new Error('No Drizzle snapshot found');
}

/* ------------------------------------------------------------------ */
/*  DDL generation from snapshot                                       */
/* ------------------------------------------------------------------ */

function buildColumnDef(col: SnapshotColumn): string {
  if (col.type === 'serial' && col.primaryKey) {
    return `${quoteIdentifier(col.name)} SERIAL PRIMARY KEY`;
  }

  let def = `${quoteIdentifier(col.name)} ${col.type}`;
  if (col.default != null) {
    def += ` DEFAULT ${col.default}`;
  }
  if (col.notNull) {
    def += ' NOT NULL';
  }
  if (col.primaryKey) {
    def += ' PRIMARY KEY';
  }
  return def;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function joinQuoted(columns: string[]): string {
  return columns.map(quoteIdentifier).join(', ');
}

function buildOptionalActionClause(
  action: string,
  keyword: 'DELETE' | 'UPDATE',
): string {
  return action !== 'no action' ? ` ON ${keyword} ${action}` : '';
}

function getColumnExpression(
  column: SnapshotIndex['columns'][number],
): string {
  return column.isExpression ? column.expression : quoteIdentifier(column.expression);
}

function buildCreateIndexSql(table: SnapshotTable, index: SnapshotIndex): string {
  const columnExpressions = index.columns.map(getColumnExpression).join(', ');
  const unique = index.isUnique ? 'UNIQUE ' : '';
  const method =
    index.method && index.method !== 'btree' ? ` USING ${index.method}` : '';
  const where = index.where ? ` WHERE ${index.where}` : '';
  return `CREATE ${unique}INDEX IF NOT EXISTS ${quoteIdentifier(index.name)} ON ${quoteIdentifier(table.name)}${method} (${columnExpressions})${where}`;
}

function buildAddForeignKeySql(table: SnapshotTable, foreignKey: SnapshotForeignKey): string {
  const fromColumns = joinQuoted(foreignKey.columnsFrom);
  const toColumns = joinQuoted(foreignKey.columnsTo);
  const onDelete = buildOptionalActionClause(foreignKey.onDelete, 'DELETE');
  const onUpdate = buildOptionalActionClause(foreignKey.onUpdate, 'UPDATE');
  return `ALTER TABLE ${quoteIdentifier(table.name)} ADD CONSTRAINT ${quoteIdentifier(foreignKey.name)} FOREIGN KEY (${fromColumns}) REFERENCES ${quoteIdentifier(foreignKey.tableTo)} (${toColumns})${onDelete}${onUpdate}`;
}

async function execIgnore(pg: PGlite, statement: string): Promise<void> {
  try {
    await pg.exec(statement);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('already exists') || msg.includes('duplicate')) return;
    throw err;
  }
}

/**
 * Build the full database schema from the latest Drizzle snapshot.
 * This avoids running individual migration files (which may have gaps
 * like no-op migrations or missing ALTER TABLE statements).
 */
async function buildSchemaFromSnapshot(pg: PGlite): Promise<void> {
  const snapshot = getLatestSnapshot();

  // 1. Create enums
  for (const enumDef of Object.values(snapshot.enums)) {
    const values = enumDef.values.map((v) => `'${v}'`).join(', ');
    await execIgnore(
      pg,
      `CREATE TYPE ${quoteIdentifier(enumDef.name)} AS ENUM (${values})`,
    );
  }

  // 2. Create tables (without foreign keys — added later)
  for (const table of Object.values(snapshot.tables)) {
    const colDefs = Object.values(table.columns).map(buildColumnDef);

    for (const uc of Object.values(table.uniqueConstraints)) {
      const cols = joinQuoted(uc.columns);
      colDefs.push(`CONSTRAINT ${quoteIdentifier(uc.name)} UNIQUE (${cols})`);
    }

    for (const cc of Object.values(table.checkConstraints)) {
      colDefs.push(`CONSTRAINT ${quoteIdentifier(cc.name)} CHECK (${cc.value})`);
    }

    await execIgnore(
      pg,
      `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(table.name)} (\n  ${colDefs.join(',\n  ')}\n)`,
    );
  }

  // 3. Create indexes
  for (const table of Object.values(snapshot.tables)) {
    for (const idx of Object.values(table.indexes)) {
      try {
        await pg.exec(buildCreateIndexSql(table, idx));
      } catch {
        // Ignore index errors (expression indexes, missing operators, etc.)
      }
    }
  }

  // 4. Add foreign keys
  for (const table of Object.values(snapshot.tables)) {
    for (const fk of Object.values(table.foreignKeys)) {
      try {
        await pg.exec(buildAddForeignKeySql(table, fk));
      } catch {
        // Ignore FK errors (missing target table, duplicate, etc.)
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export async function getTestDb(): Promise<TestDb> {
  if (db) return db;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    client = new PGlite({
      extensions: { pg_trgm },
    });

    await buildSchemaFromSnapshot(client);

    db = drizzle(client, { schema });
    return db;
  })();

  try {
    return await initPromise;
  } finally {
    initPromise = null;
  }
}

function getResetTableNames(): string[] {
  if (resetTableNamesCache) return resetTableNamesCache;
  resetTableNamesCache = Object.keys(getLatestSnapshot().tables);
  return resetTableNamesCache;
}

export async function resetTestDb(): Promise<void> {
  if (!db) throw new Error('Test DB not initialized. Call getTestDb() first.');

  const tableNames = getResetTableNames();
  if (tableNames.length === 0) return;

  const tables = tableNames.map(quoteIdentifier).join(', ');
  await db.execute(sql.raw(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`));
}

export async function closeTestDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    initPromise = null;
    snapshotCache = null;
    resetTableNamesCache = null;
  }
}
