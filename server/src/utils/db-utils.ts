import { sql } from 'drizzle-orm';

export const rowCount = sql<number>`count(*)::int`;
