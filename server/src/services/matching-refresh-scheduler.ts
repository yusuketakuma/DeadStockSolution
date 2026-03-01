import { parseBoundedInt } from '../utils/number-utils';
import { logger } from './logger';
import { processPendingMatchingRefreshJobs } from './matching-refresh-service';

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_BATCH_SIZE = 20;
const INITIAL_DELAY_MS = 1_500;

interface MatchingRefreshSchedulerConfig {
  intervalMs: number;
  batchSize: number;
}

let schedulerTimer: ReturnType<typeof setTimeout> | null = null;
let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let schedulerActive = false;
let jobRunning = false;

function readConfig(): MatchingRefreshSchedulerConfig {
  return {
    intervalMs: parseBoundedInt(
      process.env.MATCHING_REFRESH_SCHEDULER_INTERVAL_MS,
      DEFAULT_INTERVAL_MS,
      1_000,
      10 * 60 * 1000,
    ),
    batchSize: parseBoundedInt(
      process.env.MATCHING_REFRESH_SCHEDULER_BATCH_SIZE,
      DEFAULT_BATCH_SIZE,
      1,
      100,
    ),
  };
}

async function runScheduledMatchingRefresh(batchSize: number): Promise<void> {
  if (jobRunning) {
    logger.info('Matching refresh scheduler: previous run is still in progress, skipping');
    return;
  }

  jobRunning = true;
  try {
    const processed = await processPendingMatchingRefreshJobs(batchSize);
    if (processed > 0) {
      logger.info('Matching refresh scheduler processed pending jobs', {
        processed,
        batchSize,
      });
    }
  } catch (err) {
    logger.error('Matching refresh scheduler run failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    jobRunning = false;
  }
}

function clearScheduledTimers(): void {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }

  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

function scheduleLoop(intervalMs: number, batchSize: number): void {
  if (!schedulerActive) return;

  clearScheduledTimers();

  schedulerTimer = setTimeout(() => {
    schedulerTimer = null;
    if (!schedulerActive) return;
    void runScheduledMatchingRefresh(batchSize);
  }, INITIAL_DELAY_MS);
  schedulerTimer.unref();

  schedulerInterval = setInterval(() => {
    if (!schedulerActive) return;
    void runScheduledMatchingRefresh(batchSize);
  }, intervalMs);
  schedulerInterval.unref();
}

export function startMatchingRefreshScheduler(): void {
  const config = readConfig();
  if (schedulerActive) {
    logger.warn('Matching refresh scheduler already running');
    return;
  }

  schedulerActive = true;
  logger.info('Matching refresh scheduler started', {
    intervalMs: config.intervalMs,
    batchSize: config.batchSize,
  });
  scheduleLoop(config.intervalMs, config.batchSize);
}

export function stopMatchingRefreshScheduler(): void {
  const wasActive = schedulerActive || schedulerTimer !== null || schedulerInterval !== null;
  schedulerActive = false;
  jobRunning = false;
  clearScheduledTimers();

  if (wasActive) {
    logger.info('Matching refresh scheduler stopped');
  }
}

export function resetMatchingRefreshSchedulerForTests(): void {
  schedulerActive = false;
  jobRunning = false;
  clearScheduledTimers();
}
