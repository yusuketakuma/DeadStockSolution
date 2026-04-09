import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type {
  DdsRuntimeDigest,
  DdsRuntimeBufferedError,
  DdsRuntimeCodexResult,
  DdsRuntimeHealthSummary,
} from '../../../../shared/openclaw-runtime';

export type {
  DdsRuntimeDigest,
  DdsRuntimeBufferedError,
  DdsRuntimeCodexResult,
  DdsRuntimeHealthSummary,
} from '../../../../shared/openclaw-runtime';

const OPENCLAW_RUNTIME_ROOT = path.join(homedir(), '.openclaw', 'runtime');
const OPENCLAW_OPS_DIR = path.join(OPENCLAW_RUNTIME_ROOT, 'openclaw-ops');
const ERROR_BUFFER_PATH = path.join(OPENCLAW_RUNTIME_ROOT, 'dss-alerts', 'error-buffer.ndjson');
const CODEX_RESULTS_PATH = path.join(OPENCLAW_RUNTIME_ROOT, 'dss-codex', 'results.ndjson');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function readJsonLines<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as T];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

async function getLatestConnectionSummary(): Promise<DdsRuntimeHealthSummary | null> {
  try {
    const files = await readdir(OPENCLAW_OPS_DIR);
    const latest = files
      .filter((name) => /^openclaw-connection-run-\d{8}-\d{6}\.json$/.test(name))
      .sort()
      .at(-1);

    if (!latest) {
      return null;
    }

    return await readJsonFile<DdsRuntimeHealthSummary>(path.join(OPENCLAW_OPS_DIR, latest));
  } catch {
    return null;
  }
}

function sanitizeBufferedError(entry: unknown): DdsRuntimeBufferedError | null {
  if (!isRecord(entry)) {
    return null;
  }
  return {
    ts: String(entry.ts ?? ''),
    schema: String(entry.schema ?? ''),
    source: String(entry.source ?? ''),
    component: String(entry.component ?? ''),
    severity: String(entry.severity ?? ''),
    category: String(entry.category ?? ''),
    event: String(entry.event ?? ''),
    code: String(entry.code ?? ''),
    msg: String(entry.msg ?? ''),
    runId: typeof entry.runId === 'string' ? entry.runId : undefined,
    context: isRecord(entry.context) ? entry.context : {},
    artifacts: isRecord(entry.artifacts) ? entry.artifacts : {},
  };
}

function sanitizeCodexResult(entry: unknown): DdsRuntimeCodexResult | null {
  if (!isRecord(entry)) {
    return null;
  }
  return {
    ts: String(entry.ts ?? ''),
    schema: String(entry.schema ?? ''),
    source: String(entry.source ?? ''),
    component: String(entry.component ?? ''),
    status: String(entry.status ?? ''),
    type: String(entry.type ?? ''),
    summary: String(entry.summary ?? ''),
    log: typeof entry.log === 'string' ? entry.log : null,
    errorHash: typeof entry.errorHash === 'string' ? entry.errorHash : null,
    runId: typeof entry.runId === 'string' ? entry.runId : undefined,
    attempt: Number(entry.attempt ?? 0),
    maxAttempts: Number(entry.maxAttempts ?? 0),
    dedupWindowSec: Number(entry.dedupWindowSec ?? 0),
    context: isRecord(entry.context) ? entry.context : {},
    artifacts: isRecord(entry.artifacts) ? entry.artifacts : {},
  };
}

export async function getDdsRuntimeDigest(now: Date = new Date()): Promise<DdsRuntimeDigest> {
  const [latestConnection, bufferedEntriesRaw, codexEntriesRaw] = await Promise.all([
    getLatestConnectionSummary(),
    readJsonLines<unknown>(ERROR_BUFFER_PATH),
    readJsonLines<unknown>(CODEX_RESULTS_PATH),
  ]);

  const bufferedEntries = bufferedEntriesRaw
    .map(sanitizeBufferedError)
    .filter((entry): entry is DdsRuntimeBufferedError => entry !== null);
  const codexEntries = codexEntriesRaw
    .map(sanitizeCodexResult)
    .filter((entry): entry is DdsRuntimeCodexResult => entry !== null);

  const todayPrefix = now.toISOString().slice(0, 10);
  const todayCodexEntries = codexEntries.filter((entry) => entry.ts.startsWith(todayPrefix));

  return {
    generatedAt: now.toISOString(),
    latestConnection,
    bufferedErrors: {
      count: bufferedEntries.length,
      bySeverity: countBy(bufferedEntries.map((entry) => entry.severity || 'unknown')),
      bySource: countBy(bufferedEntries.map((entry) => entry.source || 'unknown')),
      recent: bufferedEntries.slice(-5),
    },
    codexResults: {
      todayCount: todayCodexEntries.length,
      todayByStatus: countBy(todayCodexEntries.map((entry) => entry.status || 'unknown')),
      recent: codexEntries.slice(-5),
    },
  };
}
