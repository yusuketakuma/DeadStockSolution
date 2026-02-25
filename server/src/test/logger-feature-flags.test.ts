import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_LOG_LEVEL = process.env.LOG_LEVEL;
const ORIGINAL_LOGGER_LAZY_PAYLOAD_ENABLED = process.env.LOGGER_LAZY_PAYLOAD_ENABLED;

async function loadLogger() {
  vi.resetModules();
  return import('../services/logger');
}

describe('logger feature flags', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (ORIGINAL_LOG_LEVEL === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = ORIGINAL_LOG_LEVEL;
    }

    if (ORIGINAL_LOGGER_LAZY_PAYLOAD_ENABLED === undefined) {
      delete process.env.LOGGER_LAZY_PAYLOAD_ENABLED;
    } else {
      process.env.LOGGER_LAZY_PAYLOAD_ENABLED = ORIGINAL_LOGGER_LAZY_PAYLOAD_ENABLED;
    }
  });

  it('keeps payload callback lazy when LOGGER_LAZY_PAYLOAD_ENABLED=true', async () => {
    process.env.LOG_LEVEL = 'error';
    process.env.LOGGER_LAZY_PAYLOAD_ENABLED = 'true';
    const payloadFactory = vi.fn(() => ({ value: 'should-not-run' }));
    const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const { logger } = await loadLogger();

    logger.info('ignored', payloadFactory);

    expect(payloadFactory).not.toHaveBeenCalled();
    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });

  it('evaluates payload callback eagerly when LOGGER_LAZY_PAYLOAD_ENABLED=false', async () => {
    process.env.LOG_LEVEL = 'error';
    process.env.LOGGER_LAZY_PAYLOAD_ENABLED = 'false';
    const payloadFactory = vi.fn(() => ({ value: 'ran' }));
    const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const { logger } = await loadLogger();

    logger.info('ignored', payloadFactory);

    expect(payloadFactory).toHaveBeenCalledOnce();
    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });
});
