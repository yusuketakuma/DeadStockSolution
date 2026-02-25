function normalizeVersion(version: string | undefined): string | null {
  const trimmed = version?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`;
}

const appVersionFromBuild = normalizeVersion(
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : undefined
);
const appVersionFromEnv = normalizeVersion(import.meta.env.VITE_APP_VERSION);

export const APP_VERSION = appVersionFromBuild ?? appVersionFromEnv ?? 'v0.0.0';
