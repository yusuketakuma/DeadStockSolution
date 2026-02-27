import { describe, expect, it } from 'vitest';
import { resolveDatabaseUrls } from '../config/database-url';

describe('resolveDatabaseUrls', () => {
  it('prefers unified URLs when provided', () => {
    const result = resolveDatabaseUrls({
      POSTGRES_URL_UNIFIED: 'postgres://shared-pooled',
      POSTGRES_URL_NON_POOLING_UNIFIED: 'postgres://shared-direct',
      POSTGRES_URL: 'postgres://fallback-pooled',
      POSTGRES_URL_NON_POOLING: 'postgres://fallback-direct',
    });

    expect(result).toEqual({
      pooledUrl: 'postgres://shared-pooled',
      nonPoolingUrl: 'postgres://shared-direct',
    });
  });

  it('uses production override URLs in preview environment', () => {
    const result = resolveDatabaseUrls({
      VERCEL_ENV: 'preview',
      POSTGRES_URL_PRODUCTION: 'postgres://production-pooled',
      POSTGRES_URL_NON_POOLING_PRODUCTION: 'postgres://production-direct',
      POSTGRES_URL: 'postgres://preview-pooled',
      POSTGRES_URL_NON_POOLING: 'postgres://preview-direct',
    });

    expect(result).toEqual({
      pooledUrl: 'postgres://production-pooled',
      nonPoolingUrl: 'postgres://production-direct',
    });
  });

  it('uses pooled override when non-pooling override is missing in preview environment', () => {
    const result = resolveDatabaseUrls({
      VERCEL_ENV: 'preview',
      POSTGRES_URL_PRODUCTION: 'postgres://production-pooled',
      POSTGRES_URL_NON_POOLING: 'postgres://preview-direct',
      POSTGRES_URL: 'postgres://preview-pooled',
    });

    expect(result).toEqual({
      pooledUrl: 'postgres://production-pooled',
      nonPoolingUrl: 'postgres://production-pooled',
    });
  });

  it('uses unified pooled URL for non-pooling when non-pooling unified is missing', () => {
    const result = resolveDatabaseUrls({
      POSTGRES_URL_UNIFIED: 'postgres://shared-pooled',
      POSTGRES_URL_NON_POOLING: 'postgres://env-direct',
      POSTGRES_URL: 'postgres://env-pooled',
    });

    expect(result).toEqual({
      pooledUrl: 'postgres://shared-pooled',
      nonPoolingUrl: 'postgres://shared-pooled',
    });
  });

  it('falls back to standard vars and local default when nothing is configured', () => {
    const standard = resolveDatabaseUrls({
      POSTGRES_URL: 'postgres://standard-pooled',
    });

    expect(standard).toEqual({
      pooledUrl: 'postgres://standard-pooled',
      nonPoolingUrl: 'postgres://standard-pooled',
    });

    const empty = resolveDatabaseUrls({});
    expect(empty).toEqual({
      pooledUrl: 'postgres://postgres:postgres@localhost:5432/postgres',
      nonPoolingUrl: 'postgres://postgres:postgres@localhost:5432/postgres',
    });
  });

  it('throws when production-like environment has no postgres URL', () => {
    expect(() => resolveDatabaseUrls({ NODE_ENV: 'production' })).toThrow(
      'Postgres URL is not configured.',
    );
    expect(() => resolveDatabaseUrls({ VERCEL_ENV: 'preview' })).toThrow(
      'Postgres URL is not configured.',
    );
  });
});
