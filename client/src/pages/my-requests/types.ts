export const LIVE_REFRESH_INTERVAL_MS = 60_000;

export const REQUEST_TEMPLATES = [
  '操作中にエラーが発生しました。再現手順は次のとおりです。',
  '医薬品マスターの更新状況を確認したいです。',
  '検索結果の表示順を改善してほしいです。',
  'OpenClaw 連携の挙動を確認したいです。',
] as const;

export interface RequestItem {
  id: number;
  requestText: string;
  category: string;
  priority: string;
  closeReason: string | null;
  assignedAdminId: number | null;
  assignedAdminName: string | null;
  requesterLastViewedAt: string | null;
  adminLastViewedAt: string | null;
  latestUserMessageAt: string | null;
  latestStaffMessageAt: string | null;
  openclawStatus: string;
  openclawThreadId: string | null;
  openclawSummary: string | null;
  workflowStatus: string | null;
  latestSummary: string | null;
  branchName: string | null;
  prUrl: string | null;
  prNumber: number | null;
  updatedAt: string | null;
  createdAt: string | null;
  hasUnread: boolean;
  waitingOn: 'user' | 'admin' | 'openclaw' | null;
  isOverdue: boolean;
}

export interface RequestMessageItem {
  id: number;
  authorType: 'user' | 'openclaw_agent' | 'system' | 'admin';
  messageType: 'message' | 'question' | 'status_update' | 'pr_report';
  body: string;
  createdAt: string | null;
  metadata: Record<string, unknown> | null;
  attachments: Array<{
    id: number;
    fileName: string;
    mimeType: string;
    fileSize: number;
  }>;
}

export interface DuplicateRequestSuggestion {
  id: number;
  requestText: string;
  category: string;
  priority: string;
  closeReason: string | null;
  createdAt: string | null;
  score: number;
}

export interface RequestThreadResponse {
  request: RequestItem & {
    lastQuestion?: string | null;
    lastError?: string | null;
  };
  messages: RequestMessageItem[];
}

export type RequestQueueFilter = 'all' | 'my_turn' | 'overdue' | 'unread' | 'openclaw';

export interface RequestSummary {
  myTurn: number;
  overdue: number;
  unread: number;
  openclaw: number;
}
