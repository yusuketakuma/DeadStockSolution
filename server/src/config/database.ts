import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';
import { resolveDatabaseUrls } from './database-url';

const { pooledUrl } = resolveDatabaseUrls();

export const db = drizzle(pooledUrl, { schema });
