import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger } from '../services/logger';

describe('logger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
});
