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

  const preferPooledForNonPooling = pooledUnifiedUrl !== undefined || pooledPreviewProductionUrl !== undefined;

  const nonPoolingUrl = normalizeEnvValue(env.POSTGRES_URL_NON_POOLING_UNIFIED)
    ?? (isPreviewEnvironment(env) ? normalizeEnvValue(env.POSTGRES_URL_NON_POOLING_PRODUCTION) : undefined)
    ?? (preferPooledForNonPooling ? pooledUrl : undefined)
    ?? normalizeEnvValue(env.POSTGRES_URL_NON_POOLING)
    ?? pooledUrl;

  return { pooledUrl, nonPoolingUrl };
}
