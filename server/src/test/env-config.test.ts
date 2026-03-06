import { describe, expect, it } from 'vitest';
import { isStrictEnvironment, resolvePort, validateRequiredCronSecrets } from '../config/env';

describe('env config helpers', () => {
  describe('resolvePort', () => {
    it('returns configured port when valid', () => {
      expect(resolvePort({ PORT: '8080' })).toBe(8080);
    });

    it('falls back to default port when invalid', () => {
      expect(resolvePort({ PORT: '0' })).toBe(3001);
      expect(resolvePort({ PORT: '-1' })).toBe(3001);
      expect(resolvePort({ PORT: 'invalid' })).toBe(3001);
    });
  });

  describe('isStrictEnvironment', () => {
    it('is true in production environments', () => {
      expect(isStrictEnvironment({ NODE_ENV: 'production' })).toBe(true);
      expect(isStrictEnvironment({ VERCEL_ENV: 'production' })).toBe(true);
    });

    it('is false in non-production environments', () => {
      expect(isStrictEnvironment({ NODE_ENV: 'development' })).toBe(false);
      expect(isStrictEnvironment({ VERCEL_ENV: 'preview' })).toBe(false);
      expect(isStrictEnvironment({})).toBe(false);
    });
  });

  describe('validateRequiredCronSecrets', () => {
    it('returns empty in non-strict environments', () => {
      expect(validateRequiredCronSecrets({ NODE_ENV: 'development' })).toEqual([]);
    });

    it('accepts shared CRON_SECRET fallback in strict environment', () => {
      expect(validateRequiredCronSecrets({ NODE_ENV: 'production', CRON_SECRET: 'shared-secret' })).toEqual([]);
    });

    it('accepts per-route secrets in strict environment', () => {
      expect(validateRequiredCronSecrets({
        NODE_ENV: 'production',
        MATCHING_REFRESH_CRON_SECRET: 'matching',
        UPLOAD_JOBS_CRON_SECRET: 'upload',
        MONTHLY_REPORT_CRON_SECRET: 'monthly',
      })).toEqual([]);
    });

    it('returns missing secret keys in strict environment', () => {
      expect(validateRequiredCronSecrets({ NODE_ENV: 'production' })).toEqual([
        'MATCHING_REFRESH_CRON_SECRET (or CRON_SECRET)',
        'UPLOAD_JOBS_CRON_SECRET (or CRON_SECRET)',
        'MONTHLY_REPORT_CRON_SECRET (or CRON_SECRET)',
      ]);
    });
  });
});
