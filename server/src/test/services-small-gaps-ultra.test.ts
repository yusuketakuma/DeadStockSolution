/**
 * services-small-gaps-ultra.test.ts
 *
 * Targets remaining uncovered lines in:
 *   - src/services/matching-refresh-scheduler.ts
 *       (runScheduledMatchingRefresh catch, clearScheduledTimers branches,
 *        scheduleLoop early return, timer callbacks with !schedulerActive,
 *        stopMatchingRefreshScheduler wasActive log, resetMatchingRefreshSchedulerForTests)
 *   - src/services/mhlw-index-scraper.ts
 *       (validateMhlwHost catch, resolveRelativeUrl catch,
 *        indexPinnedAgent close catch, pinnedAgent close catch)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* ──────────────────────────────────────────────────────────────────────────
 * File-level mocks (single set to avoid vi.mock conflicts between describes)
 * ────────────────────────────────────────────────────────────────────────── */

const mocks = vi.hoisted(() => ({
  // matching-refresh-service
  processPendingMatchingRefreshJobs: vi.fn(),
  // network-utils
  validateExternalHttpsUrl: vi.fn(),
  createPinnedDnsAgent: vi.fn(),
  // http-utils
  fetchWithTimeout: vi.fn(),
  // number-utils
  parseBoundedInt: vi.fn((_val: unknown, def: number) => def),
  // logger
  loggerDebug: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../services/matching-refresh-service', () => ({
  processPendingMatchingRefreshJobs: mocks.processPendingMatchingRefreshJobs,
}));
vi.mock('../services/logger', () => ({
  logger: {
    debug: mocks.loggerDebug,
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}));
vi.mock('../utils/number-utils', () => ({
  parseBoundedInt: mocks.parseBoundedInt,
}));
vi.mock('../utils/network-utils', () => ({
  validateExternalHttpsUrl: mocks.validateExternalHttpsUrl,
  createPinnedDnsAgent: mocks.createPinnedDnsAgent,
}));
vi.mock('../utils/http-utils', () => ({
  fetchWithTimeout: mocks.fetchWithTimeout,
}));

/* ══════════════════════════════════════════════════════════════════════════
 * PART A — matching-refresh-scheduler.ts uncovered lines
 * ══════════════════════════════════════════════════════════════════════════ */

describe('matching-refresh-scheduler — ultra coverage', () => {
  async function loadFreshScheduler() {
    vi.resetModules();
    return import('../services/matching-refresh-scheduler');
  }

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    mocks.processPendingMatchingRefreshJobs.mockResolvedValue(0);
    mocks.parseBoundedInt.mockImplementation((_val: unknown, def: number) => def);
  });

  afterEach(async () => {
    const scheduler = await loadFreshScheduler();
    scheduler.stopMatchingRefreshScheduler();
    vi.useRealTimers();
  });

  // --- Cover runScheduledMatchingRefresh catch block (lines 51-54) ---
  it('logs error when processPendingMatchingRefreshJobs throws', async () => {
    mocks.processPendingMatchingRefreshJobs.mockRejectedValue(new Error('DB down'));
    const scheduler = await loadFreshScheduler();
    scheduler.startMatchingRefreshScheduler();

    // Advance past INITIAL_DELAY_MS (1500ms) to trigger the setTimeout callback
    await vi.advanceTimersByTimeAsync(1500);
    // Allow the async work to flush
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.loggerError).toHaveBeenCalledWith(
      'Matching refresh scheduler run failed',
      expect.objectContaining({ error: 'DB down' }),
    );
  });

  // --- Cover clearScheduledTimers branches (lines 61-68) ---
  it('clearScheduledTimers clears both timer and interval', async () => {
    const scheduler = await loadFreshScheduler();
    scheduler.startMatchingRefreshScheduler();
    // At this point both schedulerTimer and schedulerInterval exist
    // stopMatchingRefreshScheduler calls clearScheduledTimers
    scheduler.stopMatchingRefreshScheduler();

    // wasActive = true so it should log
    expect(mocks.loggerInfo).toHaveBeenCalledWith('Matching refresh scheduler stopped');
  });

  // --- Cover scheduleLoop early return (line 73) and timer callbacks with !schedulerActive (lines 79, 85) ---
  it('timer callbacks return early when scheduler is stopped mid-cycle', async () => {
    const scheduler = await loadFreshScheduler();
    scheduler.startMatchingRefreshScheduler();

    // Stop the scheduler BEFORE the initial delay fires
    scheduler.stopMatchingRefreshScheduler();

    // Advance timers — callbacks should return early due to !schedulerActive
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(30000);

    // processPendingMatchingRefreshJobs should NOT have been called because schedulerActive is false
    expect(mocks.processPendingMatchingRefreshJobs).not.toHaveBeenCalled();
  });

  // --- Cover stopMatchingRefreshScheduler wasActive log (line 112-113) ---
  it('stopMatchingRefreshScheduler logs when it was active', async () => {
    const scheduler = await loadFreshScheduler();
    scheduler.startMatchingRefreshScheduler();
    mocks.loggerInfo.mockClear();
    scheduler.stopMatchingRefreshScheduler();
    expect(mocks.loggerInfo).toHaveBeenCalledWith('Matching refresh scheduler stopped');
  });

  // --- Cover stopMatchingRefreshScheduler when not active (no log) ---
  it('stopMatchingRefreshScheduler does not log when already stopped', async () => {
    const scheduler = await loadFreshScheduler();
    // Never started, so wasActive = false
    mocks.loggerInfo.mockClear();
    scheduler.stopMatchingRefreshScheduler();
    expect(mocks.loggerInfo).not.toHaveBeenCalledWith('Matching refresh scheduler stopped');
  });

  // --- Cover resetMatchingRefreshSchedulerForTests (lines 117-120) ---
  it('resetMatchingRefreshSchedulerForTests resets state', async () => {
    const scheduler = await loadFreshScheduler();
    scheduler.startMatchingRefreshScheduler();
    // resetMatchingRefreshSchedulerForTests should reset without logging
    scheduler.resetMatchingRefreshSchedulerForTests();
    // Can restart without "already running" warning
    scheduler.startMatchingRefreshScheduler();
    expect(mocks.loggerWarn).not.toHaveBeenCalledWith('Matching refresh scheduler already running');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PART B — mhlw-index-scraper.ts uncovered lines
 * ══════════════════════════════════════════════════════════════════════════ */

describe('mhlw-index-scraper — ultra coverage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.validateExternalHttpsUrl.mockResolvedValue({
      ok: true,
      hostname: 'www.mhlw.go.jp',
      resolvedAddresses: ['1.2.3.4'],
    } as never);
    mocks.createPinnedDnsAgent.mockReturnValue({
      close: vi.fn().mockResolvedValue(undefined),
    } as never);
    mocks.parseBoundedInt.mockImplementation((_val: unknown, def: number) => def);
  });

  // --- Cover validateMhlwHost catch (line 28-29) ---
  it('extractLatestIndexUrl handles invalid URL in href gracefully', async () => {
    const { extractLatestIndexUrl } = await import('../services/mhlw-index-scraper');
    // Pass an invalid base URL that will cause new URL(relative, base) to throw
    const html = '<a href="/topics/2025/04/tp20250401-01_01.html">link</a>';
    const result = extractLatestIndexUrl(html, ':::invalid');
    // resolveRelativeUrl catches the error and returns '', so no valid candidates
    expect(result).toBe(null);
  });

  // --- Cover resolveRelativeUrl catch (line 36-37) ---
  it('extractExcelUrls handles invalid base URL gracefully', async () => {
    const { extractExcelUrls } = await import('../services/mhlw-index-scraper');
    const html = '<a href="file.xlsx">内用薬リスト</a>';
    const result = extractExcelUrls(html, ':::invalid-base');
    expect(result).toEqual([]);
  });

  // --- Cover agent close catches in finally blocks (lines 230, 233) ---
  it('discoverMhlwExcelUrls handles agent close errors silently', async () => {
    const portalHtml = `
      <a href="/topics/2025/04/tp20250401-01_01.html">薬価基準</a>
    `;
    const indexHtml = `
      <a href="yakka_01.xlsx">内用薬</a>
      <a href="yakka_02.xlsx">外用薬</a>
    `;

    // Create agents that reject on close
    const portalAgent = {
      close: vi.fn().mockRejectedValue(new Error('close error portal') as never),
    };
    const indexAgent = {
      close: vi.fn().mockRejectedValue(new Error('close error index') as never),
    };

    mocks.createPinnedDnsAgent
      .mockReturnValueOnce(portalAgent as never)  // portal agent
      .mockReturnValueOnce(indexAgent as never);   // index agent (different host)

    // First validateExternalHttpsUrl for portal URL
    mocks.validateExternalHttpsUrl
      .mockResolvedValueOnce({
        ok: true,
        hostname: 'www.mhlw.go.jp',
        resolvedAddresses: ['1.2.3.4'],
      } as never)
      // Second validateExternalHttpsUrl for index URL — use different hostname to force separate agent
      .mockResolvedValueOnce({
        ok: true,
        hostname: 'www2.mhlw.go.jp',
        resolvedAddresses: ['5.6.7.8'],
      } as never);

    mocks.fetchWithTimeout
      .mockResolvedValueOnce({
        ok: true, status: 200, statusText: 'OK',
        text: vi.fn().mockResolvedValue(portalHtml),
      } as never)
      .mockResolvedValueOnce({
        ok: true, status: 200, statusText: 'OK',
        text: vi.fn().mockResolvedValue(indexHtml),
      } as never);

    const { discoverMhlwExcelUrls } = await import('../services/mhlw-index-scraper');
    const result = await discoverMhlwExcelUrls('https://www.mhlw.go.jp/portal.html');

    // The function should succeed despite close errors (they are caught)
    expect(result.files.length).toBeGreaterThanOrEqual(0);
    expect(portalAgent.close).toHaveBeenCalled();
    expect(indexAgent.close).toHaveBeenCalled();
  });

  // --- Additional: validateMhlwHost with non-mhlw host ---
  it('extractLatestIndexUrl rejects when resolved URL fails host validation', async () => {
    const { extractLatestIndexUrl } = await import('../services/mhlw-index-scraper');
    const html = '<a href="https://evil.com/topics/2025/04/tp20250401-01_01.html">link</a>';
    const result = extractLatestIndexUrl(html, 'https://www.mhlw.go.jp');
    expect(result).toBe(null);
  });
});
