export type UploadRequiredFieldsMode = 'warn' | 'strict';

const DEFAULT_STRICT_AFTER = '2026-05-01T00:00:00+09:00';

function normalizeEnvValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function resolveConfiguredStrictAfter(env: NodeJS.ProcessEnv): string {
  return normalizeEnvValue(env.UPLOAD_REQUIRED_FIELDS_STRICT_AFTER) ?? DEFAULT_STRICT_AFTER;
}

export function resolveUploadRequiredFieldsMode(
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): UploadRequiredFieldsMode {
  const override = normalizeEnvValue(env.UPLOAD_REQUIRED_FIELDS_MODE);
  if (override === 'warn' || override === 'strict') {
    return override;
  }

  const parsed = Date.parse(resolveConfiguredStrictAfter(env));
  if (!Number.isFinite(parsed)) {
    return 'warn';
  }
  return now.getTime() >= parsed ? 'strict' : 'warn';
}

export function isUploadRequiredFieldsWarningMode(
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): boolean {
  return resolveUploadRequiredFieldsMode(env, now) === 'warn';
}

export function buildUpcomingRequiredFieldWarning(fieldLabel: string): string {
  return `${fieldLabel}が未入力です。現在は警告付きで取込しますが、今後は必須になります。`;
}

export const UPLOAD_REQUIRED_FIELDS_BANNER_MESSAGE = [
  '薬品コードと薬価（単価）は今後必須になります。',
  '現在は警告付きで取込できますが、早めの列追加・値整備をお願いします。',
].join(' ');

