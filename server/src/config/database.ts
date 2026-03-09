import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import * as schema from '../db/schema';
import { resolveDatabaseUrls } from './database-url';

const { pooledUrl } = resolveDatabaseUrls();
const pool = new Pool({ connectionString: pooledUrl });

export const db = drizzle(pool, { schema });
