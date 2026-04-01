// OpenClaw管理画面で共有される型定義

export interface UserRequestItem {
  id: number;
  pharmacyId: number;
  pharmacyName: string;
  requestText: string;
  openclawStatus: string;
  openclawThreadId: string | null;
  openclawSummary: string | null;
  workflowStatus: string | null;
  latestSummary: string | null;
  branchName: string | null;
  prUrl: string | null;
  prNumber: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface RequestMessageItem {
  id: number;
  authorType: 'user' | 'openclaw_agent' | 'system' | 'admin';
  messageType: 'message' | 'question' | 'status_update' | 'pr_report';
  body: string;
  createdAt: string | null;
}

export interface RequestThreadResponse {
  request: UserRequestItem & {
    lastQuestion?: string | null;
    lastError?: string | null;
  };
  messages: RequestMessageItem[];
}

export interface RequestEventItem {
  id: number;
  eventType: string;
  createdAt: string | null;
  summary: string | null;
  note: string | null;
}

export interface UserRequestsResponse {
  data: UserRequestItem[];
  connector?: {
    configured: boolean;
    webhookConfigured: boolean;
    implementationBranch: string;
  };
}

export interface OpenClawRetryItem {
  id: number;
  requestId: number;
  pharmacyId: number;
  pharmacyName: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attemptCount: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  lastAttemptAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  triggerReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  requestText: string | null;
}

export interface OpenClawRetryResponse {
  data: OpenClawRetryItem[];
  pagination: { page: number; totalPages: number; total: number };
  stats?: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  };
}

export interface OpenClawHealthSnapshot {
  status: 'ok' | 'degraded';
  timestamp: string;
  connector: { configured: boolean; mode: string };
  webhook: { configured: boolean };
  commands: { enabled: boolean };
  logPush: { enabled: boolean };
  autoFix: { enabled: boolean };
  autoEscalate: { enabled: boolean };
  retryQueue: { pending: number; processing: number; completed: number; failed: number };
  handoffSuccessRate: number | null;
  lastHandoffAt: string | null;
  ddsAgent: {
    connected: boolean;
    agentId: string | null;
    lastSeenAt: string | null;
    queuedJobs: number;
    awaitingUser: number;
  };
}

export interface DdsAgentStatus {
  environment: string;
  connected: boolean;
  agentId: string | null;
  agentName: string | null;
  lastSeenAt: string | null;
  queuedJobs: number;
  awaitingUser: number;
  latestPrUrl: string | null;
}

export interface BootstrapTokenResponse {
  data: {
    token: string;
    expiresAt: string;
    environment: string;
    registerUrl: string;
    callbackUrl: string;
    reportUrl: string;
    commandsUrl: string;
    healthUrl: string;
  };
}

export interface RequestHandoffResponse {
  message: string;
  handoff: {
    accepted: boolean;
    connectorConfigured: boolean;
    implementationBranch: string;
    status: string;
    note: string;
  };
}

export function openclawStatusMeta(status: string): { label: string; bg: 'secondary' | 'primary' | 'warning' | 'success' } {
  switch (status) {
    case 'in_dialogue':
      return { label: '対話中', bg: 'primary' };
    case 'implementing':
      return { label: '実装中', bg: 'warning' };
    case 'completed':
      return { label: '完了', bg: 'success' };
    case 'pending_handoff':
    default:
      return { label: '連携待ち', bg: 'secondary' };
  }
}

export function workflowStatusMeta(status: string | null): { label: string; bg: 'secondary' | 'primary' | 'warning' | 'success' | 'danger' } {
  switch (status) {
    case 'awaiting_user':
      return { label: '回答待ち', bg: 'primary' };
    case 'implementing':
      return { label: '実装中', bg: 'warning' };
    case 'pr_opened':
      return { label: 'PR作成済み', bg: 'warning' };
    case 'completed':
      return { label: '完了', bg: 'success' };
    case 'failed':
      return { label: '失敗', bg: 'danger' };
    case 'analyzing':
      return { label: '解析中', bg: 'secondary' };
    case 'queued':
    default:
      return { label: '受付済み', bg: 'secondary' };
  }
}
