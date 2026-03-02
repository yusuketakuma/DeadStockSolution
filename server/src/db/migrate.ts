import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { migrate } from 'drizzle-orm/vercel-postgres/migrator';
import { db } from '../config/database';
import { logger } from '../services/logger';
import { applyPerformanceScaleIndexes } from './performance-scale-indexes';

function assertMonotonicMigrationJournal(migrationsFolder: string): void {
  // Legacy migrations contain historical out-of-order timestamps (e.g. idx 15).
  // Guard only newer entries to prevent reintroducing the skip bug on recent migrations.
  const ENFORCE_FROM_IDX = 28;
  const journalPath = path.resolve(migrationsFolder, 'meta/_journal.json');
  const raw = fs.readFileSync(journalPath, 'utf8');
  const journal = JSON.parse(raw) as {
    entries?: Array<{ idx: number; when: number; tag: string }>;
  };
  const entries = journal.entries ?? [];
  for (let i = 1; i < entries.length; i += 1) {
    const prev = entries[i - 1];
    const curr = entries[i];
    if (curr.idx >= ENFORCE_FROM_IDX && curr.when <= prev.when) {
      throw new Error(
        `Migration journal timestamp order is invalid: idx ${curr.idx} (${curr.tag}) has when=${curr.when}, ` +
        `but previous idx ${prev.idx} (${prev.tag}) has when=${prev.when}`,
      );
    }
  }
}

async function main() {
  logger.info('Running migrations...');
  const migrationsFolder = './drizzle';
  assertMonotonicMigrationJournal(migrationsFolder);
  await migrate(db, { migrationsFolder });
  await applyPerformanceScaleIndexes();
  logger.info('Migrations complete.');
  process.exit(0);
}

main().catch((err) => {
  logger.error('Migration failed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
