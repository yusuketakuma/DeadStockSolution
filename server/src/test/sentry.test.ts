import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Sentry from '@sentry/node';

// Mock Sentry
vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureException: vi.fn(() => 'event-id-123'),
}));

describe('sentry config', () => {
  let initSentry: () => void;
  let captureException: (err: unknown) => string | null;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    // Re-import to get fresh module with new env
    const sentryModule = await import('../config/sentry');
    initSentry = sentryModule.initSentry;
    captureException = sentryModule.captureException;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('initSentry', () => {
    it('initializes Sentry when SENTRY_DSN is set', () => {
      vi.stubEnv('SENTRY_DSN', 'https://test@sentry.io/123');
      vi.stubEnv('NODE_ENV', 'production');

      initSentry();

      expect(Sentry.init).toHaveBeenCalledWith({
        dsn: 'https://test@sentry.io/123',
        environment: 'production',
        tracesSampleRate: 0.1,
      });
    });

    it('does not initialize when SENTRY_DSN is not set', () => {
      vi.stubEnv('SENTRY_DSN', '');

      initSentry();

      expect(Sentry.init).not.toHaveBeenCalled();
    });

    it('uses development environment when NODE_ENV is not set', () => {
      vi.stubEnv('SENTRY_DSN', 'https://test@sentry.io/123');
      delete process.env.NODE_ENV;

      initSentry();

      expect(Sentry.init).toHaveBeenCalledWith(
        expect.objectContaining({
          environment: 'development',
        })
      );
    });
  });

  describe('captureException', () => {
    it('captures exception when SENTRY_DSN is set', () => {
      vi.stubEnv('SENTRY_DSN', 'https://test@sentry.io/123');

      const error = new Error('Test error');
      const eventId = captureException(error);

      expect(Sentry.captureException).toHaveBeenCalledWith(error);
      expect(eventId).toBe('event-id-123');
    });

    it('returns null when SENTRY_DSN is not set', () => {
      vi.stubEnv('SENTRY_DSN', '');

      const error = new Error('Test error');
      const eventId = captureException(error);

      expect(Sentry.captureException).not.toHaveBeenCalled();
      expect(eventId).toBeNull();
    });

    it('handles non-Error values', () => {
      vi.stubEnv('SENTRY_DSN', 'https://test@sentry.io/123');

      const eventId = captureException('string error');

      expect(Sentry.captureException).toHaveBeenCalledWith('string error');
      expect(eventId).toBe('event-id-123');
    });
  });
});
