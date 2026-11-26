/**
 * Cloudflare Workers エントリポイント。
 *
 * - /api/* は Express アプリ（server/src/app.ts）を cloudflare:node の httpServerHandler で処理する
 * - それ以外は wrangler の静的アセット（client/dist, SPA フォールバック）が返す
 * - Cron Triggers は内部 API（/api/internal/*）を CRON_SECRET 付きで呼び出す
 *
 * Workers ではリクエストをまたいで TCP 接続を共有できないため、
 * リクエストごとに Hyperdrive 経由の pg Pool を作り、レスポンス本文の送信完了後に閉じる。
 */
import { endGlobalScope, runDeferredTimers } from './bootstrap-env';
import { httpServerHandler } from 'cloudflare:node';
import * as Sentry from '@sentry/cloudflare';
import { Pool } from 'pg';
import app from '../src/app';
import { createDatabase, runWithDatabase } from '../src/config/database';
import { scrubPii } from '../src/config/sentry';
import { backfillTestPharmacyPasswords, ensureTestPharmacyColumnsAtStartup } from '../src/config/test-pharmacy-schema';
import { logger } from '../src/services/logger';
import { waitForPoolIdle } from '../src/utils/pool-drain';
import { buildCronRequest, findCronJobs, resolveJobSecret } from '../src/config/cloudflare-cron-jobs';

interface WorkerEnv {
  HYPERDRIVE?: Hyperdrive;
  SENTRY_DSN?: string;
  NODE_ENV?: string;
  [key: string]: unknown;
}

const EXPRESS_PORT = 8787;
const REQUEST_POOL_MAX = 5;

app.listen(EXPRESS_PORT);
const expressHandler = httpServerHandler({ port: EXPRESS_PORT });

let startupTaskStarted = false;

function resolveConnectionString(env: WorkerEnv): string {
  const fromHyperdrive = env.HYPERDRIVE?.connectionString;
  const fromEnv = process.env.POSTGRES_URL_UNIFIED ?? process.env.POSTGRES_URL;
  const connectionString = fromHyperdrive ?? fromEnv;
  if (!connectionString) {
    throw new Error('Database is not configured. Bind HYPERDRIVE or set POSTGRES_URL.');
  }
  return connectionString;
}

/**
 * レスポンス本文を流し終えた（またはクライアントが切断した）時点で onDone を呼ぶ。
 * SSE のように本文送信中も DB を使うルートがあるため、Response を返した直後には閉じない。
 */
function onResponseComplete(response: Response, ctx: ExecutionContext, onDone: () => Promise<void>): Response {
  if (!response.body) {
    ctx.waitUntil(onDone());
    return response;
  }
  const { readable, writable } = new TransformStream();
  ctx.waitUntil(response.body.pipeTo(writable).catch(() => undefined).finally(onDone));
  return new Response(readable, response);
}

/** クライアントが送った X-Forwarded-* は信用せず、Cloudflare が付与した接続元情報で上書きする */
function withForwardedHeaders(request: Request): Request {
  const headers = new Headers(request.headers);
  const clientIp = request.headers.get('cf-connecting-ip');
  if (clientIp) {
    headers.set('x-forwarded-for', clientIp);
  } else {
    headers.delete('x-forwarded-for');
  }
  const url = new URL(request.url);
  headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
  headers.set('x-forwarded-host', url.host);
  return new Request(request, { headers });
}

async function handleWithRequestDatabase(
  request: Request,
  env: WorkerEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const connectionString = resolveConnectionString(env);
  // 既存コードの resolveDatabaseUrls（本番では URL 必須）向けに process.env にも反映する
  process.env.POSTGRES_URL ??= connectionString;
  const pool = new Pool({ connectionString, max: REQUEST_POOL_MAX });
  // このリクエストで起動したバックグラウンド処理が終わるまで接続を閉じない。
  // 明示的に登録した処理に加え、await せずに起動された処理（ログ書き込みなど）も
  // Pool が使われなくなるまで待つ
  const backgroundTasks: Promise<unknown>[] = [];
  const closePool = async () => {
    await Promise.allSettled(backgroundTasks);
    const drained = await waitForPoolIdle(pool);
    if (!drained) {
      logger.warn('Request DB pool still busy at close; ending anyway', {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount,
      });
    }
    await pool.end().catch((err: unknown) => {
      logger.warn('Request DB pool close failed', { error: err instanceof Error ? err.message : String(err) });
    });
  };

  try {
    const response = await runWithDatabase(createDatabase(pool), async () => {
      if (!startupTaskStarted) {
        startupTaskStarted = true;
        // 旧 server/src/index.ts のコールドスタート処理。グローバルスコープでは I/O できないため初回リクエストで実行する
        backgroundTasks.push(
          ensureTestPharmacyColumnsAtStartup().then((ok) => (ok ? backfillTestPharmacyPasswords() : undefined)),
        );
      }
      return expressHandler.fetch!(withForwardedHeaders(request) as never, env as never, ctx);
    });
    return onResponseComplete(response as unknown as Response, ctx, closePool);
  } catch (err) {
    await closePool();
    throw err;
  }
}

async function runScheduledJobs(controller: ScheduledController, env: WorkerEnv, ctx: ExecutionContext): Promise<void> {
  const jobs = findCronJobs(controller.cron);
  if (jobs.length === 0) {
    logger.warn('No cron job registered for schedule', { cron: controller.cron });
    return;
  }

  // 1 つが失敗しても残りのジョブは実行し、最後に失敗をまとめて投げて Cron の実行結果に反映する
  const failures: string[] = [];
  for (const job of jobs) {
    const secret = resolveJobSecret(job, env);
    if (!secret) {
      logger.error('Cron secret is not configured', { path: job.path, secretEnvKey: job.secretEnvKey });
      failures.push(`${job.path}: secret not configured`);
      continue;
    }
    const response = await handleWithRequestDatabase(buildCronRequest(job, secret), env, ctx);
    const body = await response.text();
    if (!response.ok) {
      logger.error('Cron job failed', { path: job.path, status: response.status, body: body.slice(0, 500) });
      failures.push(`${job.path}: HTTP ${response.status}`);
      continue;
    }
    logger.info('Cron job completed', { path: job.path, status: response.status });
  }
  if (failures.length > 0) {
    throw new Error(`Cron jobs failed (${controller.cron}): ${failures.join(', ')}`);
  }
}

const handler: ExportedHandler<WorkerEnv> = {
  fetch: (request, env, ctx) => {
    endGlobalScope();
    runDeferredTimers();
    return handleWithRequestDatabase(request as unknown as Request, env, ctx) as never;
  },
  scheduled: (controller, env, ctx) => {
    endGlobalScope();
    runDeferredTimers();
    return runScheduledJobs(controller, env, ctx);
  },
};

export default Sentry.withSentry(
  (env: WorkerEnv) => ({
    dsn: env.SENTRY_DSN,
    enabled: Boolean(env.SENTRY_DSN),
    environment: env.NODE_ENV ?? 'production',
    tracesSampleRate: 0.1,
    beforeSend: (event) => scrubPii(event as never) as typeof event,
  }),
  handler,
);
