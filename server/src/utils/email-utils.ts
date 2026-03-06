import { sql, type SQLWrapper } from 'drizzle-orm';

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

// NOTE: lower() wrapping bypasses standard B-tree indexes on the column.
// Ensure a functional index exists: CREATE INDEX idx_pharmacies_email_lower ON pharmacies (lower(email));
// Alternatively, normalize emails at write-time so plain eq() can be used.
export function eqEmailCaseInsensitive(column: SQLWrapper, email: string) {
  return sql`lower(${column}) = ${normalizeEmail(email)}`;
}
