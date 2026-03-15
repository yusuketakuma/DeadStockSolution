/** サーバー log-center-service と同一の型定義 */

export type LogSource = 'activity_logs' | 'system_events' | 'drug_master_sync_logs';
export type LogLevel = 'critical' | 'error' | 'warning' | 'info';
export type LogIssueWorkflowStatus = 'new' | 'investigating' | 'resolved' | 'false_positive';

export interface LogIssueActor {
  pharmacyId: number | null;
  pharmacyName: string | null;
  pharmacyEmail: string | null;
}

export interface LogIssueState {
  status: LogIssueWorkflowStatus;
  note: string | null;
  updatedAt: string | null;
  updatedBy: LogIssueActor | null;
}

export interface LogIssueHistoryEntry {
  id: number;
  kind: 'status_update' | 'auto_escalation';
  source: LogSource;
  logId: number;
  status: LogIssueWorkflowStatus | null;
  note: string | null;
  reasonCodes: string[];
  createdAt: string;
  actor: LogIssueActor | null;
}

export interface NormalizedLogEntry {
  id: number;
  source: LogSource;
  level: LogLevel;
  category: string;
  errorCode: string | null;
  message: string;
  detail: unknown;
  pharmacyId: number | null;
  timestamp: string;
  whatHappened: string;
  codeLocation: string | null;
  improvementSuggestion: string | null;
  tenant: {
    pharmacyId: number | null;
    pharmacyName: string | null;
    pharmacyEmail: string | null;
    tenantLabel: string | null;
  };
  errorCodeMeta: {
    titleJa: string | null;
    descriptionJa: string | null;
    resolutionJa: string | null;
    severity: string | null;
    category: string | null;
  } | null;
  operatorState: LogIssueState;
}

export interface LogCenterResponse {
  data: NormalizedLogEntry[];
  pagination: { page: number; totalPages: number; total: number; limit: number };
}

export interface LogCenterSummary {
  total: number;
  errors: number;
  warnings: number;
  today: number;
  bySeverity: Record<string, number>;
  bySource: Record<string, number>;
}

export interface LogInsightItem {
  fingerprint: string;
  level: LogLevel;
  title: string;
  codeLocation: string | null;
  errorCode: string | null;
  count: number;
  impactedTenantCount: number;
  latestOccurredAt: string;
  sampleLogId: number;
  source: LogSource;
}

export interface LogInsightsSummary {
  repeatedErrorCount: number;
  impactedTenantCount: number;
  topIssues: LogInsightItem[];
}

export interface LogCenterOpenClawResponse {
  ok: boolean;
  escalated: boolean;
  source: LogSource;
  logId: number;
  recurrenceCount: number;
  impactedTenantCount: number;
}

export interface LogIssueStatusResponse {
  ok: boolean;
  source: LogSource;
  logId: number;
  currentState: LogIssueState;
  history: LogIssueHistoryEntry[];
}

export interface LogIssueHistoryResponse {
  source: LogSource;
  logId: number;
  history: LogIssueHistoryEntry[];
}

export interface ErrorCode {
  id: number;
  code: string;
  category: string;
  severity: string;
  titleJa: string;
  descriptionJa: string | null;
  resolutionJa: string | null;
  isActive: boolean;
}

export interface ErrorCodesResponse {
  items: ErrorCode[];
  total: number;
}

export interface CommandEntry {
  id: number;
  commandName: string;
  parameters: string | null;
  status: string;
  result: string | null;
  errorMessage: string | null;
  openclawThreadId: string | null;
  receivedAt: string;
  completedAt: string | null;
}

export interface CommandsResponse {
  commands: CommandEntry[];
}
