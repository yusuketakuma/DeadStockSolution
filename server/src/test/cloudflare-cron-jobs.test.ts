import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCronRequest, CRON_JOBS, findCronJobs, resolveJobSecret } from '../config/cloudflare-cron-jobs';

function readWranglerCrons(): { production: string[]; preview: string[] } {
  const raw = readFileSync(resolve(__dirname, '../../../wrangler.jsonc'), 'utf8');
  // JSONC のコメント行を取り除いてから解析する（文字列中に // を含む値は無い前提）
  const json = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, '')) as {
    triggers: { crons: string[] };
    env: { preview: { triggers: { crons: string[] } } };
  };
  return { production: json.triggers.crons, preview: json.env.preview.triggers.crons };
}

describe('cloudflare cron jobs', () => {
  it('registers every job schedule as a wrangler cron trigger (production and preview)', () => {
    const { production, preview } = readWranglerCrons();
    const schedules = [...new Set(CRON_JOBS.map((job) => job.cron))].sort();
    expect([...production].sort()).toEqual(schedules);
    expect([...preview].sort()).toEqual(schedules);
  });

  it('targets internal API paths only', () => {
    for (const job of CRON_JOBS) {
      expect(job.path.startsWith('/api/internal/')).toBe(true);
    }
  });

  it('finds jobs by cron expression', () => {
    expect(findCronJobs('0 19 * * *').map((job) => job.path)).toEqual(['/api/internal/drug-master-sync/run']);
    expect(findCronJobs('1 2 3 4 5')).toEqual([]);
  });

  it('prefers the job-specific secret and falls back to CRON_SECRET', () => {
    const job = findCronJobs('0 19 * * *')[0];
    expect(resolveJobSecret(job, { DRUG_MASTER_SYNC_CRON_SECRET: ' specific ', CRON_SECRET: 'shared' })).toBe('specific');
    expect(resolveJobSecret(job, { DRUG_MASTER_SYNC_CRON_SECRET: '  ', CRON_SECRET: 'shared' })).toBe('shared');
    expect(resolveJobSecret(job, {})).toBeNull();
  });

  it('builds an authorized request with the job method', async () => {
    const post = findCronJobs('0 2 * * *')[0];
    const postRequest = buildCronRequest(post, 'secret-value');
    expect(postRequest.method).toBe('POST');
    expect(new URL(postRequest.url).pathname).toBe('/api/internal/dead-stock/archive-expired');
    expect(postRequest.headers.get('authorization')).toBe('Bearer secret-value');
    expect(await postRequest.text()).toBe('{}');

    const get = findCronJobs('*/10 * * * *')[0];
    const getRequest = buildCronRequest(get, 'secret-value');
    expect(getRequest.method).toBe('GET');
    expect(getRequest.body).toBeNull();
  });
});
