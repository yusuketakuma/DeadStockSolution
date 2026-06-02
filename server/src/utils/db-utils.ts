import { sql } from 'drizzle-orm';
import { db } from '../config/database';

export const rowCount = sql<number>`count(*)::int`;

type TenantContextExecutor = Pick<typeof db, 'execute'>;

/**
 * Set the tenant context (`app.tenant_id`) for the current transaction.
 *
 * This helper intentionally uses `is_local = true`. It is only safe when the
 * protected queries run on the same transaction/connection immediately after
 * the setting is applied. Do not call it once in HTTP middleware and assume
 * later route queries on the global pool will inherit the value.
 *
 * ### Neon pooled connection compatibility
 *
 * Neon pooled connections use PgBouncer in transaction mode.
 * `set_config('app.tenant_id', ..., true)` with `is_local=true` is fully
 * compatible because:
 * - `set_config()` is a standard PostgreSQL function, not a SQL statement
 *   that PgBouncer might intercept
 * - `is_local=true` makes the setting session-local (transaction-scoped),
 *   which aligns with PgBouncer's transaction-mode lifecycle — the setting
 *   is automatically cleared when the connection returns to the pool
 * - Each tenant-scoped unit of work must set the tenant context inside the
 *   transaction that executes the RLS-protected queries.
 *
 * For non-pooled (direct) connections, `is_local=true` also works correctly:
 * the setting is scoped to the current session.
 *
 * Must be called inside the transaction that performs RLS-protected queries.
 */
export async function setTenantContext(
  tenantId: number,
  executor: TenantContextExecutor = db,
): Promise<void> {
  await executor.execute(
    sql`SELECT set_config('app.tenant_id', ${String(tenantId)}::text, true)`,
  );
}

/**
 * Execute a function within a specific tenant context.
 *
 * Opens a transaction, sets `app.tenant_id` inside that transaction, and passes
 * the same transaction client to `fn`. RLS-protected queries must use the
 * provided transaction client.
 *
 * @example
 * ```ts
 * const items = await withTenant(42, (tx) =>
 *   tx.select().from(deadStockItems)
 * );
 * ```
 */
export async function withTenant<T>(
  tenantId: number,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await setTenantContext(tenantId, tx);
    return fn(tx);
  });
}
