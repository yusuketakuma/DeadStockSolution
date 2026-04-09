export interface DdsRuntimeReason {
  level: string;
  code: string;
  message: string;
  value?: unknown;
}

export interface DdsRuntimeHealthSummary {
  schema: string;
  source: string;
  runId: string;
  timestamp: string;
  baseUrl: string;
  preflightStatus: number;
  runnerStatus: number;
  healthHttpCode: number;
  status: string;
  reason: string;
  runtime: {
    script: string;
    rootDir: string;
    runnerDir: string;
    statePath: string;
    hostName: string;
  };
  notifications: {
    telegramDmEnabled: boolean;
    telegramGroupEnabled: boolean;
    codexAutofixEnabled: boolean;
  };
  thresholds: {
    awaitingUserWarning: number;
    awaitingUserCritical: number | null;
  };
  health: {
    connectorConfigured: boolean;
    webhookConfigured: boolean;
    ddsConnected: boolean;
    awaitingUser: number;
    lastSeenAt: string | null;
  };
  diagnostics: {
    preflightLogTail: string;
    runnerLogTail: string;
  };
  alerts?: {
    enabled: boolean;
    log: string;
    reasons: DdsRuntimeReason[];
  };
  artifacts?: {
    preflightLog: string;
    runnerLog: string;
    summaryPath: string;
    alertLog: string;
    healthSnapshot: string;
    reasonsLog: string;
    runnerState: Record<string, unknown>;
  };
}

export interface DdsRuntimeBufferedError {
  ts: string;
  schema: string;
  source: string;
  component: string;
  severity: string;
  category: string;
  event: string;
  code: string;
  msg: string;
  runId?: string;
  context: Record<string, unknown>;
  artifacts: Record<string, unknown>;
}

export interface DdsRuntimeCodexResult {
  ts: string;
  schema: string;
  source: string;
  component: string;
  status: string;
  type: string;
  summary: string;
  log: string | null;
  errorHash: string | null;
  runId?: string;
  attempt: number;
  maxAttempts: number;
  dedupWindowSec: number;
  context: Record<string, unknown>;
  artifacts: Record<string, unknown>;
}

export interface DdsRuntimeDigest {
  generatedAt: string;
  latestConnection: DdsRuntimeHealthSummary | null;
  bufferedErrors: {
    count: number;
    bySeverity: Record<string, number>;
    bySource: Record<string, number>;
    recent: DdsRuntimeBufferedError[];
  };
  codexResults: {
    todayCount: number;
    todayByStatus: Record<string, number>;
    recent: DdsRuntimeCodexResult[];
  };
}
