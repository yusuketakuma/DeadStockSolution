import 'dotenv/config';
import app from './app';
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

function resolvePort(): number {
  const parsed = Number(process.env.PORT);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
    return parsed;
  }
  return 3001;
}

const PORT = resolvePort();
const SHUTDOWN_TIMEOUT_MS = 10000;

const server = app.listen(PORT, () => {
  logger.info('Server started', { port: PORT });

  // 医薬品マスター自動同期スケジューラを開始
  startDrugMasterScheduler();
  startDrugPackageScheduler();
  startImportFailureAlertScheduler();
  startMatchingRefreshScheduler();
  startMonthlyReportScheduler();
  startMonitoringKpiAlertScheduler();
});

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

  server.close((err) => {
    clearTimeout(forceCloseTimer);
    if (err) {
      logger.error('Error during server close', {
        error: err instanceof Error ? err.message : String(err),
      });
      process.exit(1);
      return;
    }
    logger.info('Server stopped');
    process.exit(0);
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

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
