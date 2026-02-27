import { createPool } from '@vercel/postgres';
import { drizzle } from 'drizzle-orm/vercel-postgres';
import * as schema from '../db/schema';
import { resolveDatabaseUrls } from './database-url';

const { pooledUrl } = resolveDatabaseUrls();
const pool = createPool({ connectionString: pooledUrl });

export const db = drizzle(pool, { schema });
