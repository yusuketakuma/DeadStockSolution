import { PGlite } from '@electric-sql/pglite';
// @ts-expect-error — contrib types may not be shipped
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import * as schema from '../../../db/schema';

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let client: PGlite | null = null;
let db: TestDb | null = null;
let initPromise: Promise<TestDb> | null = null;
let generatedSchemaCache: GeneratedSchema | null = null;

/* ------------------------------------------------------------------ */
/*  Runtime DDL generation                                             */
/* ------------------------------------------------------------------ */

interface GeneratedSchema {
  ddlStatements: string[];
  resetTableNames: string[];
}

interface SnapshotTableRef {
  name: string;
  schema?: string;
}

async function getGeneratedSchema(): Promise<GeneratedSchema> {
  if (generatedSchemaCache) return generatedSchemaCache;

  const currentSnapshot = generateDrizzleJson(schema as Record<string, unknown>);
  const ddlStatements = await generateMigration(generateDrizzleJson({}), currentSnapshot);
  const resetTableNames = Object.values(currentSnapshot.tables as Record<string, SnapshotTableRef>).map((table) => (
    table.schema && table.schema !== 'public' ? `${table.schema}.${table.name}` : table.name
  ));

  generatedSchemaCache = { ddlStatements, resetTableNames };
  return generatedSchemaCache;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function quoteQualifiedIdentifier(identifier: string): string {
  return identifier
    .split('.')
    .map((part) => quoteIdentifier(part))
    .join('.');
}

async function applyCurrentSchema(pg: PGlite): Promise<void> {
  const { ddlStatements } = await getGeneratedSchema();
  for (const statement of ddlStatements) {
    await pg.exec(statement);
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

    await applyCurrentSchema(client);

    db = drizzle(client, { schema });
    return db;
  })();

  try {
    return await initPromise;
  } finally {
    initPromise = null;
  }
}

export async function resetTestDb(): Promise<void> {
  if (!db) throw new Error('Test DB not initialized. Call getTestDb() first.');

  const { resetTableNames: tableNames } = await getGeneratedSchema();
  if (tableNames.length === 0) return;

  const tables = tableNames.map(quoteQualifiedIdentifier).join(', ');
  await db.execute(sql.raw(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`));
}

export async function closeTestDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    initPromise = null;
  }
}
