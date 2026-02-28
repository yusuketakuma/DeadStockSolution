import { timingSafeEqual } from 'crypto';

export function resolveCronSecret(...envKeys: string[]): string | null {
  for (const key of envKeys) {
    const value = process.env[key]?.trim();
    if (value && value.length > 0) return value;
  }
  const fallback = process.env.CRON_SECRET?.trim();
  return fallback && fallback.length > 0 ? fallback : null;
}

export function isAuthorizedCron(reqAuthHeader: string | undefined, secret: string): boolean {
  const expected = `Bearer ${secret}`;
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(reqAuthHeader || '', 'utf8');
  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}
