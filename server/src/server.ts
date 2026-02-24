import 'dotenv/config';
import app from './app';
import { startDrugMasterScheduler, stopDrugMasterScheduler } from './services/drug-master-scheduler';
import { seedTestAccounts } from './services/test-account-service';

const PORT = Number(process.env.PORT) || 3001;
const SHUTDOWN_TIMEOUT_MS = 10000;
const shouldSeedTestAccounts = process.env.NODE_ENV !== 'production';

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);

  if (shouldSeedTestAccounts) {
    void seedTestAccounts()
      .then((accounts) => {
        console.log(`Test pharmacy accounts are ready (${accounts.length} accounts).`);
      })
      .catch((err) => {
        console.error('Failed to seed test pharmacy accounts:', err);
      });
  }

  // 医薬品マスター自動同期スケジューラを開始
  startDrugMasterScheduler();
});

function gracefulShutdown(signal: NodeJS.Signals): void {
  console.log(`Received ${signal}. Graceful shutdown started...`);

  // 医薬品マスター自動同期スケジューラを停止
  stopDrugMasterScheduler();

  const forceCloseTimer = setTimeout(() => {
    console.error('Graceful shutdown timed out. Forcing exit.');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceCloseTimer.unref();

  server.close((err) => {
    clearTimeout(forceCloseTimer);
    if (err) {
      console.error('Error during server close:', err);
      process.exit(1);
      return;
    }
    console.log('Server stopped.');
    process.exit(0);
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  gracefulShutdown('SIGTERM');
});
