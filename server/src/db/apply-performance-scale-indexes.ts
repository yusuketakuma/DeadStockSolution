import 'dotenv/config';
import { applyPerformanceScaleIndexes } from './performance-scale-indexes';
import { logger } from '../services/logger';

async function main() {
  logger.info('Applying performance scale indexes...');
  await applyPerformanceScaleIndexes();
  logger.info('Performance scale indexes complete.');
  process.exit(0);
}

main().catch((err) => {
  logger.error('Performance scale index rollout failed', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
