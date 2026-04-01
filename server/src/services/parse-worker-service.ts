import { existsSync } from 'fs';
import { resolve } from 'path';
import { Worker } from 'worker_threads';
import { decodeCsvBuffer, parseCsvContent } from './drug-master/parser-service';
import { parseExcelBuffer } from './upload-service';

const WORKER_TIMEOUT_MS = 30_000;
export const WORKER_PARSE_MIN_BYTES = 1024 * 1024;

export type ParseFormat = 'xlsx' | 'csv';

export interface ParseOptions {
  format: ParseFormat;
}

export interface ParseResult {
  rows: unknown[][];
}

interface WorkerSuccessMessage {
  ok: true;
  rows: unknown[][];
}

interface WorkerErrorMessage {
  ok: false;
  error: string;
}

type WorkerMessage = WorkerSuccessMessage | WorkerErrorMessage;

interface WorkerConfig {
  filename: string;
  execArgv?: string[];
}

async function parseInline(buffer: Buffer, options: ParseOptions): Promise<ParseResult> {
  if (options.format === 'csv') {
    return { rows: parseCsvContent(decodeCsvBuffer(buffer)) };
  }
  return { rows: await parseExcelBuffer(buffer) };
}

function resolveWorkerConfig(): WorkerConfig | null {
  const jsWorkerPath = resolve(__dirname, '../workers/parse-worker.js');
  if (existsSync(jsWorkerPath)) {
    return { filename: jsWorkerPath };
  }

  const tsWorkerPath = resolve(__dirname, '../workers/parse-worker.ts');
  if (existsSync(tsWorkerPath)) {
    return {
      filename: tsWorkerPath,
      execArgv: ['--import', 'tsx'],
    };
  }

  return null;
}

function isWorkerSuccessMessage(message: unknown): message is WorkerSuccessMessage {
  if (!message || typeof message !== 'object') return false;
  const candidate = message as Partial<WorkerSuccessMessage>;
  return candidate.ok === true && Array.isArray(candidate.rows);
}

function isWorkerErrorMessage(message: unknown): message is WorkerErrorMessage {
  if (!message || typeof message !== 'object') return false;
  const candidate = message as Partial<WorkerErrorMessage>;
  return candidate.ok === false && typeof candidate.error === 'string';
}

export async function parseInWorker(buffer: Buffer, options: ParseOptions): Promise<ParseResult> {
  const workerConfig = resolveWorkerConfig();
  if (!workerConfig) {
    return parseInline(buffer, options);
  }

  let worker: Worker;
  try {
    worker = new Worker(workerConfig.filename, {
      workerData: { buffer, options },
      execArgv: workerConfig.execArgv,
    });
  } catch {
    return parseInline(buffer, options);
  }

  return new Promise<ParseResult>((resolvePromise, rejectPromise) => {
    let settled = false;

    const clear = (): void => {
      worker.removeListener('message', onMessage);
      worker.removeListener('error', onError);
      worker.removeListener('exit', onExit);
      clearTimeout(timeoutId);
    };

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clear();
      fn();
    };

    const onMessage = (message: WorkerMessage): void => {
      if (isWorkerSuccessMessage(message)) {
        finish(() => resolvePromise({ rows: message.rows }));
        return;
      }

      if (isWorkerErrorMessage(message)) {
        finish(() => rejectPromise(new Error(message.error)));
        return;
      }

      finish(() => rejectPromise(new Error('Worker returned invalid parse payload')));
    };

    const onError = (error: Error): void => {
      finish(() => rejectPromise(error));
    };

    const onExit = (code: number): void => {
      if (code === 0 || settled) return;
      finish(() => rejectPromise(new Error(`Worker stopped with exit code ${code}`)));
    };

    const timeoutId = setTimeout(() => {
      void worker.terminate();
      finish(() => rejectPromise(new Error('Worker parse timed out')));
    }, WORKER_TIMEOUT_MS);

    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.on('exit', onExit);
  });
}
