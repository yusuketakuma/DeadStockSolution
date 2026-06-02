const DEFAULT_LOCAL_POSTGRES_URL = 'postgres://postgres:postgres@localhost:5432/postgres';

function normalizeEnvValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function isPreviewEnvironment(env: NodeJS.ProcessEnv): boolean {
  return normalizeEnvValue(env.VERCEL_ENV) === 'preview';
}

function isStrictEnvironment(env: NodeJS.ProcessEnv): boolean {
  return normalizeEnvValue(env.NODE_ENV) === 'production'
    || normalizeEnvValue(env.VERCEL_ENV) !== undefined;
}

interface ResolvedDatabaseUrls {
  pooledUrl: string;
  nonPoolingUrl: string;
}

export function resolveDatabaseUrls(env: NodeJS.ProcessEnv = process.env): ResolvedDatabaseUrls {
  const pooledUnifiedUrl = normalizeEnvValue(env.POSTGRES_URL_UNIFIED);
  const pooledPreviewProductionUrl = isPreviewEnvironment(env)
    ? normalizeEnvValue(env.POSTGRES_URL_PRODUCTION)
    : undefined;

  const pooledUrlFromEnv = pooledUnifiedUrl
    ?? pooledPreviewProductionUrl
    ?? normalizeEnvValue(env.POSTGRES_URL);
  if (!pooledUrlFromEnv && isStrictEnvironment(env)) {
    throw new Error(
      'Postgres URL is not configured. Set POSTGRES_URL_UNIFIED or POSTGRES_URL (preview override: POSTGRES_URL_PRODUCTION).',
    );
  }
  const pooledUrl = pooledUrlFromEnv ?? DEFAULT_LOCAL_POSTGRES_URL;
  if (!pooledUrlFromEnv && env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'test') {
    console.warn('[database-url] No POSTGRES_URL configured — using default local URL. Set POSTGRES_URL or POSTGRES_URL_UNIFIED for non-local environments.');
  }

  const preferPooledForNonPooling = pooledUnifiedUrl !== undefined || pooledPreviewProductionUrl !== undefined;

  const nonPoolingUrl = normalizeEnvValue(env.POSTGRES_URL_NON_POOLING_UNIFIED)
    ?? (isPreviewEnvironment(env) ? normalizeEnvValue(env.POSTGRES_URL_NON_POOLING_PRODUCTION) : undefined)
    ?? (preferPooledForNonPooling ? pooledUrl : undefined)
    ?? normalizeEnvValue(env.POSTGRES_URL_NON_POOLING)
    ?? pooledUrl;

  return { pooledUrl, nonPoolingUrl };
}

/**
 * Resolve the admin database connection URL for the BYPASSRLS service role.
 *
 * Admin pool uses a separate PostgreSQL role with `BYPASSRLS` attribute so
 * admin routes (dashboard, nightly jobs) can read/write across all tenants
 * without RLS interference.
 *
 * Falls back to the regular pooled URL when `POSTGRES_URL_ADMIN` is not set
 * (for development environments where separate roles aren't configured).
 */
export function resolveAdminDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const adminUrl = normalizeEnvValue(env.POSTGRES_URL_ADMIN);
  if (adminUrl) return adminUrl;
  if (env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production') {
    throw new Error('POSTGRES_URL_ADMIN is required in production for admin cross-tenant database access.');
  }
  // Fallback: use the regular pooled URL (dev environments without a separate admin role)
  const { pooledUrl } = resolveDatabaseUrls(env);
  return pooledUrl;
}
