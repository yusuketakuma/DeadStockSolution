import { describe, expect, it } from 'vitest';
import { shouldAutoSeedDevelopmentAccounts } from '../services/development-seed-service';

describe('shouldAutoSeedDevelopmentAccounts', () => {
  it('returns true for local development Postgres by default', () => {
    expect(shouldAutoSeedDevelopmentAccounts({
      NODE_ENV: 'development',
      POSTGRES_URL: 'postgres://postgres:postgres@127.0.0.1:5432/postgres',
    })).toBe(true);
  });

  it('returns false for non-local databases', () => {
    expect(shouldAutoSeedDevelopmentAccounts({
      NODE_ENV: 'development',
      POSTGRES_URL: 'postgres://user:pass@db.example.com:5432/app',
    })).toBe(false);
  });

  it('returns false when auto seed is explicitly disabled', () => {
    expect(shouldAutoSeedDevelopmentAccounts({
      NODE_ENV: 'development',
      POSTGRES_URL: 'postgres://postgres:postgres@127.0.0.1:5432/postgres',
      AUTO_SEED_DEV_ACCOUNTS: 'false',
    })).toBe(false);
  });

  it('returns false for vercel environments', () => {
    expect(shouldAutoSeedDevelopmentAccounts({
      NODE_ENV: 'development',
      VERCEL_ENV: 'preview',
      POSTGRES_URL: 'postgres://postgres:postgres@127.0.0.1:5432/postgres',
    })).toBe(false);
  });
});
