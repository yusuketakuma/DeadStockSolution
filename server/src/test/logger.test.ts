import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '../services/logger';

async function importLoggerWithEnv(env: Record<string, string | undefined>) {
  const original = {
    LOG_LEVEL: process.env.LOG_LEVEL,
    LOGGER_LAZY_PAYLOAD_ENABLED: process.env.LOGGER_LAZY_PAYLOAD_ENABLED,
  };

  if (env.LOG_LEVEL === undefined) {
    delete process.env.LOG_LEVEL;
  } else {
    process.env.LOG_LEVEL = env.LOG_LEVEL;
  }

  if (env.LOGGER_LAZY_PAYLOAD_ENABLED === undefined) {
    delete process.env.LOGGER_LAZY_PAYLOAD_ENABLED;
  } else {
    process.env.LOGGER_LAZY_PAYLOAD_ENABLED = env.LOGGER_LAZY_PAYLOAD_ENABLED;
  }

  vi.resetModules();
  const mod = await import('../services/logger');

  if (original.LOG_LEVEL === undefined) {
    delete process.env.LOG_LEVEL;
  } else {
    process.env.LOG_LEVEL = original.LOG_LEVEL;
  }

  if (original.LOGGER_LAZY_PAYLOAD_ENABLED === undefined) {
    delete process.env.LOGGER_LAZY_PAYLOAD_ENABLED;
  } else {
    process.env.LOGGER_LAZY_PAYLOAD_ENABLED = original.LOGGER_LAZY_PAYLOAD_ENABLED;
  }

  return mod.logger;
}

describe('logger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete process.env.LOG_LEVEL;
    delete process.env.LOGGER_LAZY_PAYLOAD_ENABLED;
  });

  it('outputs JSON to stdout for info', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logger.info('test message', { key: 'value' });
    expect(writeSpy).toHaveBeenCalledOnce();
    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output.trim());
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('test message');
    expect(parsed.key).toBe('value');
    expect(parsed.timestamp).toBeDefined();
  });

  it('outputs JSON to stderr for error', () => {
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    logger.error('error occurred', { code: 500 });
    expect(writeSpy).toHaveBeenCalledOnce();
    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output.trim());
    expect(parsed.level).toBe('error');
    expect(parsed.msg).toBe('error occurred');
    expect(parsed.code).toBe(500);
  });

  it('outputs JSON to stderr for warn', () => {
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    logger.warn('warning');
    expect(writeSpy).toHaveBeenCalledOnce();
    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output.trim());
    expect(parsed.level).toBe('warn');
  });

  it('supports lazy payload callback', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logger.info('lazy message', () => ({ lazy: true }));
    expect(writeSpy).toHaveBeenCalledOnce();
    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output.trim());
    expect(parsed.msg).toBe('lazy message');
    expect(parsed.lazy).toBe(true);
  });

  it('covers debug path and suppressed warn with eager payload mode', async () => {
    const envLogger = await importLoggerWithEnv({
      LOG_LEVEL: 'error',
      LOGGER_LAZY_PAYLOAD_ENABLED: 'false',
    });

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    // debug is below error level -> should be suppressed branch
    envLogger.debug('debug suppressed', () => ({ value: 1 }));
    // warn is below error level -> should be suppressed branch
    envLogger.warn('warn suppressed', () => ({ value: 2 }));
    // error should be emitted and eager payload should be evaluated
    envLogger.error('error emitted', () => ({ eager: true }));

    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse((stderrSpy.mock.calls[0][0] as string).trim());
    expect(payload.msg).toBe('error emitted');
    expect(payload.eager).toBe(true);
  });

  it('emits debug when LOG_LEVEL=debug and eager mode is disabled', async () => {
    const envLogger = await importLoggerWithEnv({
      LOG_LEVEL: 'debug',
      LOGGER_LAZY_PAYLOAD_ENABLED: 'false',
    });

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    envLogger.debug('debug enabled', () => ({ enabled: true }));

    expect(stdoutSpy).toHaveBeenCalledOnce();
    const output = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(output.level).toBe('debug');
    expect(output.enabled).toBe(true);
  });
});
