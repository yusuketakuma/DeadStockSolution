/** サーバー log-center-service と同一の型定義 */

export type LogSource = 'activity_logs' | 'system_events' | 'drug_master_sync_logs';
export type LogLevel = 'critical' | 'error' | 'warning' | 'info';

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
