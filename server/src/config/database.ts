import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import * as schema from '../db/schema';
import { resolveDatabaseUrls } from './database-url';

export type Database = NodePgDatabase<typeof schema> & { $client: Pool };

// Cloudflare Workers ではリクエストをまたいで TCP 接続を再利用できないため、
// worker エントリがリクエストごとに作った DB インスタンスをここに束縛する。
// Node.js（ローカル / テスト）では束縛がなく、従来どおりプロセス共有の Pool を使う。
const requestDatabase = new AsyncLocalStorage<Database>();

let sharedDatabase: Database | null = null;

function getSharedDatabase(): Database {
  if (!sharedDatabase) {
    const { pooledUrl } = resolveDatabaseUrls();
    sharedDatabase = drizzle(pooledUrl, { schema });
  }
  return sharedDatabase;
}

export function getDatabase(): Database {
  return requestDatabase.getStore() ?? getSharedDatabase();
}

/** Workers のリクエスト単位 DB が有効か（接続に紐づくキャッシュを避けるために使う） */
export function isRequestScopedDatabase(): boolean {
  return requestDatabase.getStore() !== undefined;
}

export function createDatabase(client: Pool): Database {
  return drizzle(client, { schema });
}

export function runWithDatabase<T>(database: Database, fn: () => T): T {
  return requestDatabase.run(database, fn);
}

export const db: Database = new Proxy({} as Database, {
  get(_target, prop) {
    const target = getDatabase();
    const value = Reflect.get(target, prop, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
