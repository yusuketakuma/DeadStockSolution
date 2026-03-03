import 'dotenv/config';
import app from './app';
import { resolvePort, validateRequiredCronSecrets } from './config/env';
import { ensureTestPharmacyColumnsAtStartup } from './config/test-pharmacy-schema';
import { startDrugMasterScheduler, stopDrugMasterScheduler } from './services/drug-master-scheduler';
import { startDrugPackageScheduler, stopDrugPackageScheduler } from './services/drug-package-scheduler';
import { startImportFailureAlertScheduler, stopImportFailureAlertScheduler } from './services/import-failure-alert-scheduler';
import { startMatchingRefreshScheduler, stopMatchingRefreshScheduler } from './services/matching-refresh-scheduler';
import { startMonthlyReportScheduler, stopMonthlyReportScheduler } from './services/monthly-report-scheduler';
import {
  startMonitoringKpiAlertScheduler,
  stopMonitoringKpiAlertScheduler,
} from './services/monitoring-kpi-alert-scheduler';
import { logger } from './services/logger';
import { recordUncaughtException, recordUnhandledRejection } from './services/system-event-service';

const PORT = resolvePort();
const SHUTDOWN_TIMEOUT_MS = 10000;
let server: ReturnType<typeof app.listen> | null = null;

function startSchedulers(): void {
  logger.info('Server started', { port: PORT });

  // 医薬品マスター自動同期スケジューラを開始
  startDrugMasterScheduler();
  startDrugPackageScheduler();
  startImportFailureAlertScheduler();
  startMatchingRefreshScheduler();
  startMonthlyReportScheduler();
  startMonitoringKpiAlertScheduler();
}

async function bootstrapServer(): Promise<void> {
  const missingCronSecrets = validateRequiredCronSecrets();
  if (missingCronSecrets.length > 0) {
    throw new Error(
      `Missing required cron secret environment variables: ${missingCronSecrets.join(', ')}`,
    );
  }

  await ensureTestPharmacyColumnsAtStartup();

  server = app.listen(PORT, startSchedulers);
}

function gracefulShutdown(signal: NodeJS.Signals): void {
  logger.info('Graceful shutdown started', { signal });

  // 医薬品マスター自動同期スケジューラを停止
  stopDrugMasterScheduler();
  stopDrugPackageScheduler();
  stopImportFailureAlertScheduler();
  stopMatchingRefreshScheduler();
  stopMonthlyReportScheduler();
  stopMonitoringKpiAlertScheduler();

  const forceCloseTimer = setTimeout(() => {
    logger.error('Graceful shutdown timed out. Forcing exit.');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceCloseTimer.unref();

  if (!server) {
    clearTimeout(forceCloseTimer);
    logger.info('Server was not started; exiting immediately');
    process.exit(0);
    return;
  }

  server.close((err) => {
    clearTimeout(forceCloseTimer);
    if (err) {
      logger.error('Error during server close', {
        error: err instanceof Error ? err.message : String(err),
      });
      process.exit(1);
    }
    logger.info('Server stopped');
    process.exit(0);
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

void bootstrapServer().catch((err) => {
  logger.error('Server bootstrap failed', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
  void recordUnhandledRejection(reason);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', {
    error: err instanceof Error ? err.message : String(err),
    stack: err.stack,
  });
  void recordUncaughtException(err);
  gracefulShutdown('SIGTERM');
});
