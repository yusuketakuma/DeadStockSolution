/**
 * misc-services-final.test.ts
 * Covers uncovered lines in openclaw-command-service.ts: logs.query, stats.summary, cache.clear handlers
 */
import { describe, expect, it, vi } from 'vitest';

const openclawMocks = vi.hoisted(() => ({
  queryLogs: vi.fn(async () => [{ id: 1, level: 'info', message: 'test log' }]),
  getLogSummary: vi.fn(async () => ({ totalEntries: 100, byLevel: { info: 100 } })),
}));

vi.mock('../services/log-center-service', async () => {
  const actual = await vi.importActual<typeof import('../services/log-center-service')>('../services/log-center-service');
  return {
    ...actual,
    queryLogs: openclawMocks.queryLogs,
    getLogSummary: openclawMocks.getLogSummary,
  };
});

vi.mock('../config/database', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { BUILTIN_COMMANDS } from '../services/openclaw-command-service';

describe('openclaw-command-service — BUILTIN_COMMANDS handlers', () => {
  describe('logs.query handler (lines 72-82)', () => {
    it('calls queryLogs with validated parameters and returns results', async () => {
      const logsQueryHandler = BUILTIN_COMMANDS['logs.query']?.handler;
      if (!logsQueryHandler) throw new Error('logs.query handler not found');

      const result = await logsQueryHandler({
        sources: ['activity_logs'],
        level: 'info',
        search: 'test',
        limit: 10,
      });

      expect(openclawMocks.queryLogs).toHaveBeenCalledWith(expect.objectContaining({
        search: 'test',
        limit: 10,
      }));
      expect(result).toEqual([{ id: 1, level: 'info', message: 'test log' }]);
    });

    it('handles empty params (optional fields default)', async () => {
      const logsQueryHandler = BUILTIN_COMMANDS['logs.query']?.handler;
      if (!logsQueryHandler) throw new Error('logs.query handler not found');

      const result = await logsQueryHandler({});

      expect(openclawMocks.queryLogs).toHaveBeenCalledWith(expect.objectContaining({
        limit: 50, // default
      }));
      expect(result).toBeDefined();
    });
  });

  describe('stats.summary handler (lines 87-90)', () => {
    it('calls getLogSummary and returns summary', async () => {
      const statsSummaryHandler = BUILTIN_COMMANDS['stats.summary']?.handler;
      if (!statsSummaryHandler) throw new Error('stats.summary handler not found');

      const result = await statsSummaryHandler({});

      expect(openclawMocks.getLogSummary).toHaveBeenCalled();
      expect(result).toEqual({ totalEntries: 100, byLevel: { info: 100 } });
    });
  });

  describe('cache.clear handler (line 95)', () => {
    it('returns cleared: true with timestamp', async () => {
      const cacheClearHandler = BUILTIN_COMMANDS['cache.clear']?.handler;
      if (!cacheClearHandler) throw new Error('cache.clear handler not found');

      const result = await cacheClearHandler({}) as { cleared: boolean; timestamp: string };

      expect(result.cleared).toBe(true);
      expect(typeof result.timestamp).toBe('string');
    });
  });
});
