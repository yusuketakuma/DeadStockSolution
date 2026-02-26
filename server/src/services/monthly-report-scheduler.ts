import { logger } from './logger';
import { generateMonthlyReport, resolveDefaultTargetMonth, validateYearMonth } from './monthly-report-service';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let schedulerActive = false;
let lastGeneratedKey: string | null = null;

function keyOf(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

async function runScheduledGeneration(now: Date): Promise<void> {
  const day = now.getUTCDate();
  if (day > 3) {
    return;
  }

  const { year, month } = resolveDefaultTargetMonth(now);
  const key = keyOf(year, month);
  if (key === lastGeneratedKey) {
    return;
  }

  try {
    validateYearMonth(year, month);
    await generateMonthlyReport(year, month, null);
    lastGeneratedKey = key;
    logger.info('Monthly report scheduler generated report', { year, month });
  } catch (err) {
    logger.error('Monthly report scheduler failed', {
      year,
      month,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function triggerManualMonthlyReport(year: number, month: number): Promise<void> {
  validateYearMonth(year, month);
  await generateMonthlyReport(year, month, null);
  lastGeneratedKey = keyOf(year, month);
}

export function startMonthlyReportScheduler(): void {
  if (schedulerActive) {
    logger.warn('Monthly report scheduler already running');
    return;
  }

  const enabledRaw = process.env.MONTHLY_REPORT_SCHEDULER_ENABLED?.trim().toLowerCase();
  const enabled = enabledRaw === 'true' || enabledRaw === '1';
  if (!enabled) {
    logger.info('Monthly report scheduler is disabled');
    return;
  }

  schedulerActive = true;
  logger.info('Monthly report scheduler started', { intervalMs: CHECK_INTERVAL_MS });

  void runScheduledGeneration(new Date());
  schedulerTimer = setInterval(() => {
    void runScheduledGeneration(new Date());
  }, CHECK_INTERVAL_MS);
  schedulerTimer.unref();
}

export function stopMonthlyReportScheduler(): void {
  schedulerActive = false;
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  logger.info('Monthly report scheduler stopped');
}
