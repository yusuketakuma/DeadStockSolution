function normalizeEnvValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

export function isStrictEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  const nodeEnv = normalizeEnvValue(env.NODE_ENV);
  const vercelEnv = normalizeEnvValue(env.VERCEL_ENV);
  return nodeEnv === 'production' || vercelEnv === 'production';
}

export function resolvePort(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.PORT);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
    return parsed;
  }
  return 3001;
}

function resolveCronSecret(env: NodeJS.ProcessEnv, ...envKeys: string[]): string | null {
  for (const key of envKeys) {
    const value = normalizeEnvValue(env[key]);
    if (value) {
      return value;
    }
  }

  const fallback = normalizeEnvValue(env.CRON_SECRET);
  return fallback ?? null;
}

export function validateRequiredCronSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  if (!isStrictEnvironment(env)) {
    return [];
  }

  const missing: string[] = [];
  if (!resolveCronSecret(env, 'MATCHING_REFRESH_CRON_SECRET')) {
    missing.push('MATCHING_REFRESH_CRON_SECRET (or CRON_SECRET)');
  }
  if (!resolveCronSecret(env, 'UPLOAD_JOBS_CRON_SECRET')) {
    missing.push('UPLOAD_JOBS_CRON_SECRET (or CRON_SECRET)');
  }
  if (!resolveCronSecret(env, 'MONTHLY_REPORT_CRON_SECRET')) {
    missing.push('MONTHLY_REPORT_CRON_SECRET (or CRON_SECRET)');
  }

  return missing;
}
