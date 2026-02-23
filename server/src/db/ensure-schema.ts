import { client } from '../config/database';

let ensurePromise: Promise<void> | null = null;

async function exec(sql: string): Promise<void> {
  await client.execute(sql);
}

export async function ensureAuxiliarySchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    await exec(`
      CREATE TABLE IF NOT EXISTS admin_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_admin_id INTEGER NOT NULL REFERENCES pharmacies(id),
        target_type TEXT NOT NULL DEFAULT 'all',
        target_pharmacy_id INTEGER REFERENCES pharmacies(id),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        action_path TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await exec(`
      CREATE TABLE IF NOT EXISTS admin_message_reads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL REFERENCES admin_messages(id),
        pharmacy_id INTEGER NOT NULL REFERENCES pharmacies(id),
        read_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_message_reads_unique
      ON admin_message_reads(message_id, pharmacy_id)
    `);

    await exec(`
      CREATE INDEX IF NOT EXISTS idx_admin_messages_target
      ON admin_messages(target_type, target_pharmacy_id, created_at)
    `);

    // Performance indexes for high-traffic queries
    await exec(`
      CREATE INDEX IF NOT EXISTS idx_uploads_pharmacy_type_created
      ON uploads(pharmacy_id, upload_type, created_at)
    `);

    await exec(`
      CREATE INDEX IF NOT EXISTS idx_dead_stock_pharmacy_available_created
      ON dead_stock_items(pharmacy_id, is_available, created_at)
    `);

    await exec(`
      CREATE INDEX IF NOT EXISTS idx_dead_stock_available_name
      ON dead_stock_items(is_available, drug_name)
    `);

    await exec(`
      CREATE INDEX IF NOT EXISTS idx_used_medication_pharmacy_created
      ON used_medication_items(pharmacy_id, created_at)
    `);

    await exec(`
      CREATE INDEX IF NOT EXISTS idx_exchange_proposals_a_proposed
      ON exchange_proposals(pharmacy_a_id, proposed_at)
    `);

    await exec(`
      CREATE INDEX IF NOT EXISTS idx_exchange_proposals_b_proposed
      ON exchange_proposals(pharmacy_b_id, proposed_at)
    `);

    await exec(`
      CREATE INDEX IF NOT EXISTS idx_exchange_proposals_status_proposed
      ON exchange_proposals(status, proposed_at)
    `);

    await exec(`
      CREATE INDEX IF NOT EXISTS idx_exchange_items_proposal
      ON exchange_proposal_items(proposal_id)
    `);

    await exec(`
      CREATE INDEX IF NOT EXISTS idx_exchange_history_a_completed
      ON exchange_history(pharmacy_a_id, completed_at)
    `);

    await exec(`
      CREATE INDEX IF NOT EXISTS idx_exchange_history_b_completed
      ON exchange_history(pharmacy_b_id, completed_at)
    `);

    await exec(`
      CREATE INDEX IF NOT EXISTS idx_mapping_templates_pharmacy_type_hash
      ON column_mapping_templates(pharmacy_id, upload_type, header_hash)
    `);
  })();

  return ensurePromise;
}
