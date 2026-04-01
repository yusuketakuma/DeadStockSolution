const DEFAULT_STRICT_AFTER = '2026-05-01T00:00:00+09:00';

function normalizeEnvValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function resolveMode(now: Date = new Date()): 'warn' | 'strict' {
  const override = normalizeEnvValue(import.meta.env.VITE_UPLOAD_REQUIRED_FIELDS_MODE);
  if (override === 'warn' || override === 'strict') {
    return override;
  }

  const strictAfter = normalizeEnvValue(import.meta.env.VITE_UPLOAD_REQUIRED_FIELDS_STRICT_AFTER) ?? DEFAULT_STRICT_AFTER;
  const parsed = Date.parse(strictAfter);
  if (!Number.isFinite(parsed)) {
    return 'warn';
  }
  return now.getTime() >= parsed ? 'strict' : 'warn';
}

export function resolveUploadRequiredFieldsBannerMessage(now: Date = new Date()): string | null {
  if (resolveMode(now) === 'strict') {
    return null;
  }
  return '薬品コードと薬価（単価）は今後必須になります。現在は警告付きで取込できますが、早めの列追加・値整備をお願いします。';
}

