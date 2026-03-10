import { afterEach, describe, expect, it, vi } from 'vitest';

async function importLoggerWithEnv(env: Partial<NodeJS.ProcessEnv>) {
  vi.resetModules();
  const previous = { ...process.env };
  process.env = { ...process.env, ...env };
  const mod = await import('../services/logger');
  process.env = previous;
  return mod.logger;
}

describe('logger branch coverage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('does not emit debug when LOG_LEVEL=info', async () => {
    const logger = await importLoggerWithEnv({ LOG_LEVEL: 'info' });
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logger.debug('hidden-debug', { a: 1 });
    expect(outSpy).not.toHaveBeenCalled();
  });

  it('emits debug when LOG_LEVEL=debug', async () => {
    const logger = await importLoggerWithEnv({ LOG_LEVEL: 'debug' });
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logger.debug('visible-debug', { a: 1 });
    expect(outSpy).toHaveBeenCalledOnce();
    expect(String(outSpy.mock.calls[0][0])).toContain('"level":"debug"');
  });

  it('falls back to info level when LOG_LEVEL is invalid', async () => {
    const logger = await importLoggerWithEnv({ LOG_LEVEL: 'invalid-level' });
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logger.info('visible-info', { visible: true });
    logger.debug('hidden-debug', { hidden: true });
    expect(outSpy).toHaveBeenCalledOnce();
    expect(String(outSpy.mock.calls[0][0])).toContain('"level":"info"');
  });

  it('suppresses info and emits warn when LOG_LEVEL=warn', async () => {
    const logger = await importLoggerWithEnv({ LOG_LEVEL: 'warn' });
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    logger.info('hidden-info', { v: 1 });
    logger.warn('visible-warn', { v: 2 });

    expect(outSpy).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledOnce();
    expect(String(errSpy.mock.calls[0][0])).toContain('"level":"warn"');
  });

  it('resolves plain object payload for info log', async () => {
    const logger = await importLoggerWithEnv({ LOG_LEVEL: 'info' });
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    logger.info('object-payload', { key: 'value' });

    expect(outSpy).toHaveBeenCalledOnce();
    expect(String(outSpy.mock.calls[0][0])).toContain('"key":"value"');
  });

  it('does not evaluate callback payload for suppressed levels', async () => {
    const logger = await importLoggerWithEnv({ LOG_LEVEL: 'error' });
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const debugPayload = vi.fn(() => ({ d: true }));
    const infoPayload = vi.fn(() => ({ i: true }));
    const warnPayload = vi.fn(() => ({ w: true }));
    const errorPayload = vi.fn(() => ({ e: true }));

    logger.debug('debug-suppressed', debugPayload);
    logger.info('info-suppressed', infoPayload);
    logger.warn('warn-suppressed', warnPayload);
    logger.error('error-visible', errorPayload);

    expect(debugPayload).not.toHaveBeenCalled();
    expect(infoPayload).not.toHaveBeenCalled();
    expect(warnPayload).not.toHaveBeenCalled();
    expect(errorPayload).toHaveBeenCalledTimes(1);
    expect(outSpy).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledOnce();
    expect(String(errSpy.mock.calls[0][0])).toContain('"level":"error"');
  });

  it('handles undefined payloads for all levels', async () => {
    const logger = await importLoggerWithEnv({ LOG_LEVEL: 'debug' });
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    logger.debug('debug-no-payload');
    logger.info('info-no-payload');
    logger.warn('warn-no-payload');
    logger.error('error-no-payload');

    expect(outSpy).toHaveBeenCalledTimes(2);
    expect(errSpy).toHaveBeenCalledTimes(2);
  });

  it('does not throw when suppressed payload callback fails', async () => {
    const logger = await importLoggerWithEnv({ LOG_LEVEL: 'error' });
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    expect(() => logger.info('suppressed-info', () => {
      throw new Error('payload exploded');
    })).not.toThrow();
    expect(outSpy).not.toHaveBeenCalled();
  });

  it('emits fallback metadata when visible payload callback fails', async () => {
    const logger = await importLoggerWithEnv({ LOG_LEVEL: 'info' });
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    logger.info('visible-info', () => {
      throw new Error('payload exploded');
    });

    expect(outSpy).toHaveBeenCalledOnce();
    expect(String(outSpy.mock.calls[0][0])).toContain('"logPayloadResolveError":"payload exploded"');
  });
});
