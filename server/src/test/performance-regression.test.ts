import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const PERF_REGRESSION_ENABLED = isTruthy(process.env.PERF_REGRESSION_ENABLED);
const PERF_BASELINE_UPDATE = isTruthy(process.env.PERF_BASELINE_UPDATE);

const WARMUP_RUNS = parseEnvInt('PERF_WARMUP_RUNS', 8, 0, 500);
const MEASURED_RUNS = parseEnvInt('PERF_MEASURED_RUNS', 40, 5, 2000);
const RELATIVE_TOLERANCE = parseEnvFloat('PERF_RELATIVE_TOLERANCE', 0.35, 0, 5);
const ABSOLUTE_TOLERANCE_P50_MS = parseEnvFloat('PERF_ABSOLUTE_P50_MS', 4, 0, 1000);
const ABSOLUTE_TOLERANCE_P95_MS = parseEnvFloat('PERF_ABSOLUTE_P95_MS', 15, 0, 2000);

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const BENCHMARK_FILE_BUFFER = Buffer.from('benchmark-xlsx-content');
const BENCHMARK_FILE_NAME = 'benchmark.xlsx';

const DEFAULT_MAPPING = {
  drug_code: '0',
  drug_name: '1',
  quantity: '2',
  unit: null,
  yakka_unit_price: null,
  expiration_date: null,
  lot_number: null,
};

const PARSED_ROWS: unknown[][] = [
  ['YJコード', '薬剤名', '数量'],
  ['1111111F1111', '薬A', 10],
  ['2222222F2222', '薬B', 5],
];
const PREVIEW_ROWS: string[][] = [
  ['1111111F1111', '薬A', '10'],
  ['2222222F2222', '薬B', '5'],
];
const EXTRACTED_ROWS = [
  {
    drugCode: '1111111F1111',
    drugName: '薬A',
    quantity: 10,
    unit: '錠',
    yakkaUnitPrice: 10,
    yakkaTotal: 100,
    expirationDate: null,
    lotNumber: null,
  },
  {
    drugCode: '2222222F2222',
    drugName: '薬B',
    quantity: 5,
    unit: '錠',
    yakkaUnitPrice: 20,
    yakkaTotal: 100,
    expirationDate: null,
    lotNumber: null,
  },
];

type ScenarioKey =
  | 'post_api_exchange_find'
  | 'post_api_upload_preview'
  | 'post_api_upload_confirm'
  | 'get_api_inventory_browse'
  | 'get_api_pharmacies_list'
  | 'scheduler_import_failure_alert_check';

interface ScenarioMetric {
  p50Ms: number;
  p95Ms: number;
  samples: number;
}

interface RegressionTolerances {
  relative: number;
  absoluteMs: {
    p50: number;
    p95: number;
  };
}

interface PerformanceBaseline {
  version: 1;
  generatedAt: string;
  environment: {
    node: string;
    platform: NodeJS.Platform;
  };
  warmupRuns: number;
  measuredRuns: number;
  tolerances: RegressionTolerances;
  metrics: Record<ScenarioKey, ScenarioMetric>;
}

interface ScenarioDefinition {
  key: ScenarioKey;
  label: string;
  setup: () => void;
  run: () => Promise<void>;
}

const mockState = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    transaction: vi.fn(),
  },
  findMatches: vi.fn(),
  parseExcelBuffer: vi.fn(),
  getPreviewRows: vi.fn(),
  detectHeaderRow: vi.fn(),
  detectUploadType: vi.fn(),
  suggestMapping: vi.fn(),
  computeHeaderHash: vi.fn(),
  extractDeadStockRows: vi.fn(),
  extractUsedMedicationRows: vi.fn(),
  enrichWithDrugMaster: vi.fn(),
  enqueueUploadConfirmJob: vi.fn(),
  getUploadConfirmJobForPharmacy: vi.fn(),
  cancelUploadConfirmJobForPharmacy: vi.fn(),
  isUploadConfirmQueueLimitError: vi.fn(),
  isUploadConfirmIdempotencyConflictError: vi.fn(),
  loggerDebug: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  writeLog: vi.fn(),
  getClientIp: vi.fn(),
  handoffImportFailureAlertToOpenClaw: vi.fn(),
}));

vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (
    req: { user?: { id: number; email: string; isAdmin: boolean } },
    _res: unknown,
    next: () => void,
  ) => {
    req.user = { id: 1, email: 'perf@example.com', isAdmin: false };
    next();
  },
}));

vi.mock('../config/database', () => ({
  db: mockState.db,
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  or: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  asc: vi.fn(() => ({})),
  gte: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  like: vi.fn(() => ({})),
  notExists: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

vi.mock('../services/matching-service', () => ({
  findMatches: mockState.findMatches,
}));

vi.mock('../services/exchange-service', () => ({
  createProposal: vi.fn(),
  acceptProposal: vi.fn(),
  rejectProposal: vi.fn(),
  completeProposal: vi.fn(),
}));

vi.mock('../services/upload-service', () => ({
  parseExcelBuffer: mockState.parseExcelBuffer,
  getPreviewRows: mockState.getPreviewRows,
}));

vi.mock('../services/column-mapper', () => ({
  detectHeaderRow: mockState.detectHeaderRow,
  detectUploadType: mockState.detectUploadType,
  suggestMapping: mockState.suggestMapping,
  computeHeaderHash: mockState.computeHeaderHash,
}));

vi.mock('../services/data-extractor', () => ({
  extractDeadStockRows: mockState.extractDeadStockRows,
  extractUsedMedicationRows: mockState.extractUsedMedicationRows,
}));

vi.mock('../services/drug-master-enrichment', () => ({
  enrichWithDrugMaster: mockState.enrichWithDrugMaster,
}));

vi.mock('../services/upload-confirm-job-service', () => ({
  enqueueUploadConfirmJob: mockState.enqueueUploadConfirmJob,
  getUploadConfirmJobForPharmacy: mockState.getUploadConfirmJobForPharmacy,
  cancelUploadConfirmJobForPharmacy: mockState.cancelUploadConfirmJobForPharmacy,
  isUploadConfirmQueueLimitError: mockState.isUploadConfirmQueueLimitError,
  isUploadConfirmIdempotencyConflictError: mockState.isUploadConfirmIdempotencyConflictError,
}));

vi.mock('../services/log-service', () => ({
  writeLog: mockState.writeLog,
  getClientIp: mockState.getClientIp,
}));

vi.mock('../services/openclaw-auto-handoff-service', () => ({
  handoffImportFailureAlertToOpenClaw: mockState.handoffImportFailureAlertToOpenClaw,
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: mockState.loggerDebug,
    info: mockState.loggerInfo,
    warn: mockState.loggerWarn,
    error: mockState.loggerError,
  },
}));

import exchangeRouter from '../routes/exchange';
import inventoryRouter from '../routes/inventory';
import pharmaciesRouter from '../routes/pharmacies';
import uploadRouter from '../routes/upload';
import {
  resetImportFailureAlertStateForTests,
  runImportFailureAlertCheck,
  type ImportFailureAlertConfig,
} from '../services/import-failure-alert-scheduler';

function isTruthy(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

function parseEnvInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseEnvFloat(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function createApp() {
  const app = express();
  app.use('/api/exchange', exchangeRouter);
  app.use('/api/upload', uploadRouter);
  app.use('/api/inventory', inventoryRouter);
  app.use('/api/pharmacies', pharmaciesRouter);
  return app;
}

function createSelectQueryResult<T>(rows: T) {
  const query = {
    from: () => query,
    innerJoin: () => query,
    where: () => query,
    orderBy: () => query,
    limit: () => query,
    offset: () => query,
    then: (resolve: (value: T) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };

  return query;
}

function configureSharedMocks(): void {
  mockState.getClientIp.mockReturnValue('127.0.0.1');
  mockState.parseExcelBuffer.mockResolvedValue(PARSED_ROWS);
  mockState.getPreviewRows.mockReturnValue(PREVIEW_ROWS);
  mockState.detectHeaderRow.mockReturnValue(0);
  mockState.detectUploadType.mockReturnValue({
    detectedType: 'dead_stock',
    confidence: 'high',
    scores: {
      dead_stock: 20,
      used_medication: 5,
    },
  });
  mockState.suggestMapping.mockReturnValue(DEFAULT_MAPPING);
  mockState.computeHeaderHash.mockReturnValue('perf-header-hash');
  mockState.extractDeadStockRows.mockReturnValue(EXTRACTED_ROWS);
  mockState.extractUsedMedicationRows.mockReturnValue(EXTRACTED_ROWS);
  mockState.enrichWithDrugMaster.mockImplementation(async (rows: unknown[]) => rows);
  mockState.enqueueUploadConfirmJob.mockResolvedValue({
    jobId: 9001,
    status: 'pending',
    deduplicated: false,
    cancelable: true,
    canceledAt: null,
  });
  mockState.getUploadConfirmJobForPharmacy.mockResolvedValue(null);
  mockState.cancelUploadConfirmJobForPharmacy.mockResolvedValue(null);
  mockState.isUploadConfirmQueueLimitError.mockReturnValue(false);
  mockState.isUploadConfirmIdempotencyConflictError.mockReturnValue(false);

  mockState.handoffImportFailureAlertToOpenClaw.mockResolvedValue({
    triggered: false,
    accepted: false,
    requestId: null,
  });
}

function configureExchangeBenchmark(): void {
  resetMocksForScenario();
  configureSharedMocks();
  mockState.findMatches.mockResolvedValue([{ targetPharmacyId: 2, score: 0.93 }]);
}

function configureUploadPreviewBenchmark(): void {
  resetMocksForScenario();
  configureSharedMocks();

  mockState.db.select.mockImplementation(() => createSelectQueryResult([]));
}

function configureUploadConfirmBenchmark(): void {
  resetMocksForScenario();
  configureSharedMocks();
}

function configureInventoryBrowseBenchmark(): void {
  resetMocksForScenario();
  configureSharedMocks();

  mockState.db.select.mockImplementation((fields?: Record<string, unknown>) => {
    if (fields && typeof fields === 'object' && 'count' in fields) {
      return createSelectQueryResult([{ count: 1 }]);
    }

    if (fields && typeof fields === 'object' && 'drugName' in fields) {
      return createSelectQueryResult([
        {
          id: 10,
          pharmacyId: 2,
          drugName: '薬A',
          quantity: 10,
          unit: '錠',
          packageLabel: 'PTP',
          yakkaUnitPrice: '10.00',
          yakkaTotal: '100.00',
          expirationDate: null,
          pharmacyName: 'Perf Pharmacy',
          prefecture: '東京都',
        },
      ]);
    }

    if (fields && typeof fields === 'object' && 'dayOfWeek' in fields) {
      return createSelectQueryResult([
        {
          pharmacyId: 2,
          dayOfWeek: 1,
          openTime: '09:00',
          closeTime: '18:00',
          isClosed: false,
          is24Hours: false,
        },
      ]);
    }

    if (fields && typeof fields === 'object' && 'specialType' in fields) {
      return createSelectQueryResult([]);
    }

    return createSelectQueryResult([]);
  });
}

function configurePharmaciesListBenchmark(): void {
  resetMocksForScenario();
  configureSharedMocks();

  mockState.db.select.mockImplementation((fields?: Record<string, unknown>) => {
    if (fields && typeof fields === 'object' && 'count' in fields) {
      return createSelectQueryResult([{ count: 1 }]);
    }

    if (fields && typeof fields === 'object' && 'distance' in fields) {
      return createSelectQueryResult([
        {
          id: 2,
          name: 'Perf Pharmacy',
          prefecture: '東京都',
          address: '東京都千代田区1-1-1',
          phone: '03-0000-0000',
          fax: '03-0000-0001',
          latitude: null,
          longitude: null,
          distance: null,
        },
      ]);
    }

    if (fields && typeof fields === 'object' && 'dayOfWeek' in fields) {
      return createSelectQueryResult([
        {
          pharmacyId: 2,
          dayOfWeek: 1,
          openTime: '09:00',
          closeTime: '18:00',
          isClosed: false,
          is24Hours: false,
        },
      ]);
    }

    if (fields && typeof fields === 'object' && 'specialType' in fields) {
      return createSelectQueryResult([]);
    }

    return createSelectQueryResult([]);
  });
}

function configureSchedulerBenchmark(failureCount: number): ImportFailureAlertConfig {
  resetMocksForScenario();
  configureSharedMocks();

  mockState.db.select.mockImplementation(() => ({
    from: () => ({
      where: async () => [{ count: failureCount }],
    }),
  }));

  return {
    enabled: true,
    intervalMinutes: 5,
    windowMinutes: 30,
    threshold: 3,
    cooldownMinutes: 60,
    monitoredActions: ['upload'],
    webhookUrl: '',
    webhookUrlError: null,
    webhookToken: '',
    webhookTimeoutMs: 1000,
  };
}

function getLastLoggerErrorDetails(): string {
  const lastCall = mockState.loggerError.mock.calls.at(-1);
  if (!lastCall) {
    return 'no logger.error call captured';
  }

  const [message, detailOrFactory] = lastCall;
  const detail = typeof detailOrFactory === 'function'
    ? detailOrFactory()
    : detailOrFactory;

  return JSON.stringify({ message, detail });
}

function resetMocksForScenario(): void {
  mockState.db.select.mockReset();
  mockState.db.transaction.mockReset();
  mockState.findMatches.mockReset();
  mockState.parseExcelBuffer.mockReset();
  mockState.getPreviewRows.mockReset();
  mockState.detectHeaderRow.mockReset();
  mockState.detectUploadType.mockReset();
  mockState.suggestMapping.mockReset();
  mockState.computeHeaderHash.mockReset();
  mockState.extractDeadStockRows.mockReset();
  mockState.extractUsedMedicationRows.mockReset();
  mockState.enrichWithDrugMaster.mockReset();
  mockState.enqueueUploadConfirmJob.mockReset();
  mockState.getUploadConfirmJobForPharmacy.mockReset();
  mockState.cancelUploadConfirmJobForPharmacy.mockReset();
  mockState.isUploadConfirmQueueLimitError.mockReset();
  mockState.isUploadConfirmIdempotencyConflictError.mockReset();
  mockState.loggerDebug.mockReset();
  mockState.loggerInfo.mockReset();
  mockState.loggerWarn.mockReset();
  mockState.loggerError.mockReset();
  mockState.writeLog.mockReset();
  mockState.getClientIp.mockReset();
  mockState.handoffImportFailureAlertToOpenClaw.mockReset();

  resetImportFailureAlertStateForTests();
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    throw new Error('Cannot compute percentile with empty sample set');
  }

  const position = (sorted.length - 1) * p;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) {
    return sorted[lowerIndex];
  }

  const ratio = position - lowerIndex;
  return sorted[lowerIndex] + (sorted[upperIndex] - sorted[lowerIndex]) * ratio;
}

function roundMs(value: number): number {
  return Number(value.toFixed(3));
}

async function benchmarkScenario(scenario: ScenarioDefinition): Promise<ScenarioMetric> {
  scenario.setup();

  for (let i = 0; i < WARMUP_RUNS; i += 1) {
    await scenario.run();
  }

  const samples: number[] = [];
  for (let i = 0; i < MEASURED_RUNS; i += 1) {
    const startedAt = process.hrtime.bigint();
    await scenario.run();
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    samples.push(elapsedMs);
  }

  samples.sort((a, b) => a - b);
  return {
    p50Ms: roundMs(percentile(samples, 0.5)),
    p95Ms: roundMs(percentile(samples, 0.95)),
    samples: MEASURED_RUNS,
  };
}

function resolveBaselinePath(): string {
  const cwd = process.cwd();
  if (path.basename(cwd) === 'server') {
    return path.resolve(cwd, 'perf', 'baseline.json');
  }
  return path.resolve(cwd, 'server', 'perf', 'baseline.json');
}

const BASELINE_FILE_PATH = resolveBaselinePath();

async function writeBaseline(metrics: Record<ScenarioKey, ScenarioMetric>): Promise<void> {
  const baseline: PerformanceBaseline = {
    version: 1,
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
    },
    warmupRuns: WARMUP_RUNS,
    measuredRuns: MEASURED_RUNS,
    tolerances: {
      relative: RELATIVE_TOLERANCE,
      absoluteMs: {
        p50: ABSOLUTE_TOLERANCE_P50_MS,
        p95: ABSOLUTE_TOLERANCE_P95_MS,
      },
    },
    metrics,
  };

  await fs.mkdir(path.dirname(BASELINE_FILE_PATH), { recursive: true });
  await fs.writeFile(BASELINE_FILE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
}

async function loadBaseline(): Promise<PerformanceBaseline> {
  try {
    const raw = await fs.readFile(BASELINE_FILE_PATH, 'utf8');
    return JSON.parse(raw) as PerformanceBaseline;
  } catch (err) {
    const maybeErr = err as NodeJS.ErrnoException;
    if (maybeErr.code === 'ENOENT') {
      throw new Error(
        `Baseline not found at ${BASELINE_FILE_PATH}. Run PERF_BASELINE_UPDATE=true npm run test:perf --workspace=server first.`,
      );
    }
    throw err;
  }
}

function collectRegressions(
  baseline: PerformanceBaseline,
  measured: Record<ScenarioKey, ScenarioMetric>,
  scenarioLabels: Record<ScenarioKey, string>,
): string[] {
  const failures: string[] = [];
  const absoluteP50ToleranceMs = Math.max(
    baseline.tolerances.absoluteMs.p50,
    ABSOLUTE_TOLERANCE_P50_MS,
  );
  const absoluteP95ToleranceMs = Math.max(
    baseline.tolerances.absoluteMs.p95,
    ABSOLUTE_TOLERANCE_P95_MS,
  );

  for (const scenarioKey of Object.keys(scenarioLabels) as ScenarioKey[]) {
    const baselineMetric = baseline.metrics[scenarioKey];
    const measuredMetric = measured[scenarioKey];

    if (!baselineMetric) {
      failures.push(`${scenarioLabels[scenarioKey]}: missing baseline metric`);
      continue;
    }

    const allowedP50 = baselineMetric.p50Ms + Math.max(
      baselineMetric.p50Ms * baseline.tolerances.relative,
      absoluteP50ToleranceMs,
    );
    const allowedP95 = baselineMetric.p95Ms + Math.max(
      baselineMetric.p95Ms * baseline.tolerances.relative,
      absoluteP95ToleranceMs,
    );

    if (measuredMetric.p50Ms > allowedP50) {
      failures.push(
        `${scenarioLabels[scenarioKey]} p50 regression: current=${measuredMetric.p50Ms}ms baseline=${baselineMetric.p50Ms}ms allowed=${roundMs(allowedP50)}ms`,
      );
    }

    if (measuredMetric.p95Ms > allowedP95) {
      failures.push(
        `${scenarioLabels[scenarioKey]} p95 regression: current=${measuredMetric.p95Ms}ms baseline=${baselineMetric.p95Ms}ms allowed=${roundMs(allowedP95)}ms`,
      );
    }
  }

  return failures;
}

const perfSuite = PERF_REGRESSION_ENABLED ? describe : describe.skip;

perfSuite('performance regression guard', () => {
  it('tracks benchmark baseline and detects meaningful regressions', async () => {
    const app = createApp();
    const api = request(app);
    const schedulerConfig = configureSchedulerBenchmark(2);

    const scenarioLabels: Record<ScenarioKey, string> = {
      post_api_exchange_find: 'POST /api/exchange/find',
      post_api_upload_preview: 'POST /api/upload/preview',
      post_api_upload_confirm: 'POST /api/upload/confirm-async',
      get_api_inventory_browse: 'GET /api/inventory/browse',
      get_api_pharmacies_list: 'GET /api/pharmacies',
      scheduler_import_failure_alert_check: 'scheduler import-failure check',
    };

    const scenarios: ScenarioDefinition[] = [
      {
        key: 'post_api_exchange_find',
        label: scenarioLabels.post_api_exchange_find,
        setup: () => {
          configureExchangeBenchmark();
        },
        run: async () => {
          const response = await api.post('/api/exchange/find');
          if (response.status !== 200) {
            throw new Error(`POST /api/exchange/find returned ${response.status}: ${JSON.stringify(response.body)}`);
          }
          if (!Array.isArray(response.body.candidates)) {
            throw new Error('POST /api/exchange/find response missing candidates array');
          }
        },
      },
      {
        key: 'post_api_upload_preview',
        label: scenarioLabels.post_api_upload_preview,
        setup: () => {
          configureUploadPreviewBenchmark();
        },
        run: async () => {
          const response = await api
            .post('/api/upload/preview')
            .field('uploadType', 'dead_stock')
            .attach('file', BENCHMARK_FILE_BUFFER, {
              filename: BENCHMARK_FILE_NAME,
              contentType: XLSX_CONTENT_TYPE,
            });

          if (response.status !== 200) {
            throw new Error(
              `POST /api/upload/preview returned ${response.status}: ${JSON.stringify(response.body)}; `
              + `logger=${getLastLoggerErrorDetails()}`,
            );
          }
        },
      },
      {
        key: 'post_api_upload_confirm',
        label: scenarioLabels.post_api_upload_confirm,
        setup: () => {
          configureUploadConfirmBenchmark();
        },
        run: async () => {
          const response = await api
            .post('/api/upload/confirm-async')
            .field('uploadType', 'dead_stock')
            .field('headerRowIndex', '0')
            .field('mapping', JSON.stringify(DEFAULT_MAPPING))
            .attach('file', BENCHMARK_FILE_BUFFER, {
              filename: BENCHMARK_FILE_NAME,
              contentType: XLSX_CONTENT_TYPE,
            });

          if (response.status !== 202) {
            throw new Error(`POST /api/upload/confirm-async returned ${response.status}`);
          }
        },
      },
      {
        key: 'get_api_inventory_browse',
        label: scenarioLabels.get_api_inventory_browse,
        setup: () => {
          configureInventoryBrowseBenchmark();
        },
        run: async () => {
          const response = await api.get('/api/inventory/browse');

          if (response.status !== 200) {
            throw new Error(`GET /api/inventory/browse returned ${response.status}`);
          }

          if (!Array.isArray(response.body.data)) {
            throw new Error('GET /api/inventory/browse response missing data array');
          }
        },
      },
      {
        key: 'get_api_pharmacies_list',
        label: scenarioLabels.get_api_pharmacies_list,
        setup: () => {
          configurePharmaciesListBenchmark();
        },
        run: async () => {
          const response = await api.get('/api/pharmacies');

          if (response.status !== 200) {
            throw new Error(`GET /api/pharmacies returned ${response.status}`);
          }

          if (!Array.isArray(response.body.data)) {
            throw new Error('GET /api/pharmacies response missing data array');
          }
        },
      },
      {
        key: 'scheduler_import_failure_alert_check',
        label: scenarioLabels.scheduler_import_failure_alert_check,
        setup: () => {
          configureSchedulerBenchmark(2);
        },
        run: async () => {
          const result = await runImportFailureAlertCheck(schedulerConfig, new Date('2026-02-24T00:00:00.000Z'));
          if (result.status !== 'below_threshold') {
            throw new Error(`scheduler check returned ${result.status}`);
          }
        },
      },
    ];

    const measuredMetrics = {} as Record<ScenarioKey, ScenarioMetric>;

    for (const scenario of scenarios) {
      measuredMetrics[scenario.key] = await benchmarkScenario(scenario);
      console.info(
        `[perf] ${scenario.label}: p50=${measuredMetrics[scenario.key].p50Ms}ms p95=${measuredMetrics[scenario.key].p95Ms}ms`,
      );
    }

    if (PERF_BASELINE_UPDATE) {
      await writeBaseline(measuredMetrics);
      expect(true).toBe(true);
      return;
    }

    const baseline = await loadBaseline();
    const failures = collectRegressions(baseline, measuredMetrics, scenarioLabels);

    if (failures.length > 0) {
      throw new Error(`Performance regression detected:\n${failures.join('\n')}`);
    }

    expect(failures).toHaveLength(0);
  }, 120_000);
});
