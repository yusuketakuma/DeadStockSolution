export function buildSafeCliEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USER: process.env.USER,
    LANG: process.env.LANG ?? 'en_US.UTF-8',
  };
}

const SAFE_CLI_PATH_PATTERN = /^[a-zA-Z0-9/_.-]+$/;

export function isSafeCliPath(cliPath: string): boolean {
  if (cliPath.length === 0 || cliPath.length > 256) return false;
  if (!SAFE_CLI_PATH_PATTERN.test(cliPath)) return false;
  if (cliPath.includes('..')) return false;
  return true;
}
