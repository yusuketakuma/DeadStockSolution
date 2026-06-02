import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';
import { resolveAdminDatabaseUrl } from './database-url';

/**
 * Admin database connection using the BYPASSRLS service role.
 *
 * This pool bypasses Row-Level Security entirely, allowing admin routes
 * (dashboard, nightly aggregation jobs, cross-tenant queries) to read/write
 * across all tenants without RLS interference.
 *
 * Usage in admin route files:
 * ```ts
 * import { adminDb } from '../config/database-admin';
 * const allItems = await adminDb.select().from(deadStockItems);
 * ```
 *
 * Configure via `POSTGRES_URL_ADMIN` env var (a connection string for the
 * `deadstock_service` role with BYPASSRLS attribute). Falls back to the
 * regular pool URL in development.
 */
export const adminDb = drizzle(resolveAdminDatabaseUrl(), { schema });
