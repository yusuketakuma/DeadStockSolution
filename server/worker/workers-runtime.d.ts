/**
 * worker エントリで使う Workers ランタイム API の最小限の型。
 * @cloudflare/workers-types を全体に読み込むと Node 向けの src/ と型が衝突するため、必要なものだけ宣言する。
 */
interface Hyperdrive {
  readonly connectionString: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ScheduledController {
  readonly cron: string;
  readonly scheduledTime: number;
  noRetry(): void;
}

interface ExportedHandler<Env = unknown> {
  fetch?: (request: Request, env: Env, ctx: ExecutionContext) => Response | Promise<Response>;
  scheduled?: (controller: ScheduledController, env: Env, ctx: ExecutionContext) => void | Promise<void>;
}

declare module 'cloudflare:node' {
  export function httpServerHandler(options: { port: number }): ExportedHandler;
}
