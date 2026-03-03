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
      return JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')) as Snapshot;
    }
  }
  throw new Error('No Drizzle snapshot found');
}

/* ------------------------------------------------------------------ */
/*  DDL generation from snapshot                                       */
/* ------------------------------------------------------------------ */

function buildColumnDef(col: SnapshotColumn): string {
  if (col.type === 'serial' && col.primaryKey) {
    return `"${col.name}" SERIAL PRIMARY KEY`;
  }

  let def = `"${col.name}" ${col.type}`;
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
      `CREATE TYPE "${enumDef.name}" AS ENUM (${values})`,
    );
  }

  // 2. Create tables (without foreign keys — added later)
  for (const table of Object.values(snapshot.tables)) {
    const colDefs = Object.values(table.columns).map(buildColumnDef);

    for (const uc of Object.values(table.uniqueConstraints)) {
      const cols = uc.columns.map((c) => `"${c}"`).join(', ');
      colDefs.push(`CONSTRAINT "${uc.name}" UNIQUE (${cols})`);
    }

    for (const cc of Object.values(table.checkConstraints)) {
      colDefs.push(`CONSTRAINT "${cc.name}" CHECK (${cc.value})`);
    }

    await execIgnore(
      pg,
      `CREATE TABLE IF NOT EXISTS "${table.name}" (\n  ${colDefs.join(',\n  ')}\n)`,
    );
  }

  // 3. Create indexes
  for (const table of Object.values(snapshot.tables)) {
    for (const idx of Object.values(table.indexes)) {
      const colExprs = idx.columns
        .map((c) => (c.isExpression ? c.expression : `"${c.expression}"`))
        .join(', ');
      const unique = idx.isUnique ? 'UNIQUE ' : '';
      const method =
        idx.method && idx.method !== 'btree' ? ` USING ${idx.method}` : '';
      const where = idx.where ? ` WHERE ${idx.where}` : '';
      try {
        await pg.exec(
          `CREATE ${unique}INDEX IF NOT EXISTS "${idx.name}" ON "${table.name}"${method} (${colExprs})${where}`,
        );
      } catch {
        // Ignore index errors (expression indexes, missing operators, etc.)
      }
    }
  }

  // 4. Add foreign keys
  for (const table of Object.values(snapshot.tables)) {
    for (const fk of Object.values(table.foreignKeys)) {
      const fromCols = fk.columnsFrom.map((c) => `"${c}"`).join(', ');
      const toCols = fk.columnsTo.map((c) => `"${c}"`).join(', ');
      const onDelete =
        fk.onDelete !== 'no action'
          ? ` ON DELETE ${fk.onDelete}`
          : '';
      const onUpdate =
        fk.onUpdate !== 'no action'
          ? ` ON UPDATE ${fk.onUpdate}`
          : '';
      try {
        await pg.exec(
          `ALTER TABLE "${table.name}" ADD CONSTRAINT "${fk.name}" FOREIGN KEY (${fromCols}) REFERENCES "${fk.tableTo}" (${toCols})${onDelete}${onUpdate}`,
        );
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

  client = new PGlite({
    extensions: { pg_trgm },
  });

  await buildSchemaFromSnapshot(client);

  db = drizzle(client, { schema });
  return db;
}

const TABLE_NAMES = [
  'predictive_alerts',
  'match_notifications',
  'match_candidate_snapshots',
  'dead_stock_reservations',
  'matching_refresh_jobs',
  'upload_row_issues',
  'upload_confirm_jobs',
  'exchange_proposal_items',
  'exchange_history',
  'exchange_feedback',
  'proposal_comments',
  'exchange_proposals',
  'used_medication_items',
  'dead_stock_items',
  'uploads',
  'activity_logs',
  'system_events',
  'admin_message_reads',
  'admin_messages',
  'user_requests',
  'password_reset_tokens',
  'pharmacy_business_hours',
  'pharmacy_special_hours',
  'pharmacy_relationships',
  'pharmacy_trust_scores',
  'pharmacy_registration_reviews',
  'notifications',
  'monthly_reports',
  'column_mapping_templates',
  'drug_master_price_history',
  'drug_master_packages',
  'drug_master_sync_logs',
  'drug_master',
  'drug_master_source_state',
  'error_codes',
  'openclaw_commands',
  'openclaw_command_whitelist',
  'matching_rule_profiles',
  'pharmacies',
];

export async function resetTestDb(): Promise<void> {
  if (!db) throw new Error('Test DB not initialized. Call getTestDb() first.');

  for (const table of TABLE_NAMES) {
    await db.execute(sql.raw(`TRUNCATE TABLE "${table}" CASCADE`));
  }
  for (const table of TABLE_NAMES) {
    await db.execute(
      sql.raw(`ALTER SEQUENCE IF EXISTS "${table}_id_seq" RESTART WITH 1`),
    );
  }
}

export async function closeTestDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
