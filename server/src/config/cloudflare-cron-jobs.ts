/**
 * Cloudflare Cron Triggers から呼び出す内部ジョブ定義。
 * 旧 vercel.json の crons と同じスケジュール・エンドポイントを維持する。
 * method は各ルートが受け付ける HTTP メソッドに合わせる（Vercel Cron は常に GET だったため
 * POST 専用ルートは 404 になっていた）。
 */
export interface CronJob {
  cron: string;
  path: string;
  method: 'GET' | 'POST';
  /** 個別シークレットの環境変数名。未設定時は CRON_SECRET にフォールバックする */
  secretEnvKey: string;
}

export const CRON_JOBS: readonly CronJob[] = [
  { cron: '*/10 * * * *', path: '/api/internal/matching-refresh/retry', method: 'GET', secretEnvKey: 'MATCHING_REFRESH_CRON_SECRET' },
  { cron: '* * * * *', path: '/api/internal/upload-jobs/retry', method: 'POST', secretEnvKey: 'UPLOAD_JOBS_CRON_SECRET' },
  { cron: '*/5 * * * *', path: '/api/internal/openclaw-retries/run', method: 'POST', secretEnvKey: 'OPENCLAW_RETRIES_CRON_SECRET' },
  { cron: '0 1 1 * *', path: '/api/internal/monthly-reports/run', method: 'GET', secretEnvKey: 'MONTHLY_REPORT_CRON_SECRET' },
  { cron: '0 2 * * *', path: '/api/internal/dead-stock/archive-expired', method: 'POST', secretEnvKey: 'DEAD_STOCK_ARCHIVE_CRON_SECRET' },
  { cron: '0 18 * * *', path: '/api/internal/daily-statistics/aggregate', method: 'POST', secretEnvKey: 'DAILY_STATISTICS_CRON_SECRET' },
  { cron: '0 * * * *', path: '/api/internal/proposals/expire-stale', method: 'POST', secretEnvKey: 'PROPOSAL_EXPIRY_CRON_SECRET' },
  { cron: '0 19 * * *', path: '/api/internal/drug-master-sync/run', method: 'POST', secretEnvKey: 'DRUG_MASTER_SYNC_CRON_SECRET' },
];

export function findCronJobs(cron: string): CronJob[] {
  return CRON_JOBS.filter((job) => job.cron === cron);
}

export function resolveJobSecret(job: CronJob, env: Record<string, unknown>): string | null {
  for (const key of [job.secretEnvKey, 'CRON_SECRET']) {
    const value = env[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

export function buildCronRequest(job: CronJob, secret: string, origin = 'https://cron.internal'): Request {
  return new Request(new URL(job.path, origin), {
    method: job.method,
    headers: {
      authorization: `Bearer ${secret}`,
      'user-agent': 'cloudflare-cron',
      'content-type': 'application/json',
    },
    body: job.method === 'POST' ? '{}' : undefined,
  });
}
