/**
 * OpenClaw タスクエンベロープ構築
 *
 * openclaw-service.ts から分割。タスク種別分類、成果物定義、
 * 会話コンテキスト解析、コールバック構築、エンベロープ組み立てを担当する。
 */

import type {
  OpenClawConfig,
  OpenClawHandoffInput,
} from './connector-config';
import { resolveAppBaseUrl } from './connector-config';

export type OpenClawTaskKind = 'user_report' | 'incident_investigation' | 'verification_review';

export interface OpenClawTaskConversationMessage {
  id?: number;
  authorType: string;
  messageType: string;
  body: string;
  createdAt?: string | null;
}

export interface OpenClawTaskCallbacks {
  reportUrl: string;
  callbackUrl: string;
  commandsUrl: string;
  auth: 'openclaw_webhook_hmac';
}

export interface OpenClawTaskEnvelope {
  sourceSystem: 'DeadStockSolution';
  source: string;
  taskKind: OpenClawTaskKind;
  request: {
    id: number;
    pharmacyId: number;
    text: string;
    idempotencyKey: string;
    threadId?: string | null;
  };
  execution: {
    owner: 'openclaw';
    mode: 'task_managed';
    useTaskManager: true;
    useCodingWorkflow: true;
    openPullRequestWhenNeeded: true;
    askFollowUpQuestionsWhenNeeded: boolean;
    implementationBranch: string;
  };
  deliverables: string[];
  callbacks?: OpenClawTaskCallbacks;
  conversation?: {
    latestMessageId: number | null;
    messages: OpenClawTaskConversationMessage[];
  };
  context?: Record<string, unknown>;
}

function resolveTaskSource(input: OpenClawHandoffInput): string {
  const source = input.context?.source;
  if (typeof source === 'string' && source.trim()) {
    return source.trim().slice(0, 64);
  }
  return 'user_request';
}

function resolveThreadId(input: OpenClawHandoffInput): string | null {
  const threadId = input.context?.threadId;
  if (typeof threadId === 'string' && threadId.trim()) {
    return threadId.trim().slice(0, 120);
  }
  return null;
}

function sanitizeConversationMessage(value: unknown): OpenClawTaskConversationMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const entry = value as Record<string, unknown>;
  if (typeof entry.body !== 'string' || !entry.body.trim()) {
    return null;
  }

  return {
    ...(typeof entry.id === 'number' ? { id: entry.id } : {}),
    authorType: typeof entry.authorType === 'string' && entry.authorType.trim() ? entry.authorType.trim() : 'system',
    messageType: typeof entry.messageType === 'string' && entry.messageType.trim() ? entry.messageType.trim() : 'message',
    body: entry.body.trim().slice(0, 4000),
    ...(typeof entry.createdAt === 'string' ? { createdAt: entry.createdAt } : {}),
  };
}

function readConversationFromContext(input: OpenClawHandoffInput): OpenClawTaskEnvelope['conversation'] | undefined {
  const conversation = input.context?.conversation;
  if (!conversation || typeof conversation !== 'object' || Array.isArray(conversation)) {
    return undefined;
  }

  const rawMessages = Array.isArray((conversation as Record<string, unknown>).messages)
    ? (conversation as Record<string, unknown>).messages as unknown[]
    : [];
  const messages = rawMessages
    .map((entry) => sanitizeConversationMessage(entry))
    .filter((entry): entry is OpenClawTaskConversationMessage => Boolean(entry));

  if (messages.length === 0) {
    return undefined;
  }

  const latestMessageIdRaw = (conversation as Record<string, unknown>).latestMessageId;
  return {
    latestMessageId: typeof latestMessageIdRaw === 'number' ? latestMessageIdRaw : null,
    messages,
  };
}

function buildTaskCallbacks(): OpenClawTaskCallbacks | undefined {
  const appBaseUrl = resolveAppBaseUrl();
  if (!appBaseUrl) {
    return undefined;
  }

  return {
    reportUrl: `${appBaseUrl}/api/openclaw/report`,
    callbackUrl: `${appBaseUrl}/api/openclaw/callback`,
    commandsUrl: `${appBaseUrl}/api/openclaw/commands`,
    auth: 'openclaw_webhook_hmac',
  };
}

function classifyTaskKind(input: OpenClawHandoffInput): OpenClawTaskKind {
  const source = resolveTaskSource(input);
  if (source === 'import_failure_alert_scheduler' || source === 'admin_log_investigation') {
    return 'incident_investigation';
  }
  if (source === 'pharmacy_verification_request') {
    return 'verification_review';
  }
  return 'user_report';
}

function buildTaskDeliverables(taskKind: OpenClawTaskKind): string[] {
  if (taskKind === 'incident_investigation') {
    return [
      'ログと周辺文脈を確認して原因を切り分ける',
      '必要なら修正を実装する',
      'コード変更がある場合は review ブランチ向け PR を作成する',
      '進捗と結論を DeadStockSolution 側へ返す',
    ];
  }

  if (taskKind === 'verification_review') {
    return [
      '再審査依頼の内容を確認する',
      '必要な追加確認があれば先に返す',
      '結論を DeadStockSolution 側へ返す',
    ];
  }

  return [
    '要望内容を整理する',
    '不明点があれば先に質問する',
    '実装が必要なら OpenClaw の coding workflow で進める',
    'コード変更がある場合は review ブランチ向け PR を作成する',
  ];
}

export function buildTaskEnvelope(
  config: OpenClawConfig,
  input: OpenClawHandoffInput,
  idempotencyKey: string,
): OpenClawTaskEnvelope {
  const taskKind = classifyTaskKind(input);
  const callbacks = buildTaskCallbacks();
  const conversation = readConversationFromContext(input);
  const threadId = resolveThreadId(input);
  return {
    sourceSystem: 'DeadStockSolution',
    source: resolveTaskSource(input),
    taskKind,
    request: {
      id: input.requestId,
      pharmacyId: input.pharmacyId,
      text: input.requestText,
      idempotencyKey,
      ...(threadId ? { threadId } : {}),
    },
    execution: {
      owner: 'openclaw',
      mode: 'task_managed',
      useTaskManager: true,
      useCodingWorkflow: true,
      openPullRequestWhenNeeded: true,
      askFollowUpQuestionsWhenNeeded: taskKind !== 'incident_investigation',
      implementationBranch: config.implementationBranch,
    },
    deliverables: buildTaskDeliverables(taskKind),
    ...(callbacks ? { callbacks } : {}),
    ...(conversation ? { conversation } : {}),
    ...(input.context && Object.keys(input.context).length > 0 ? { context: input.context } : {}),
  };
}

export function buildGatewayCliMessage(task: OpenClawTaskEnvelope): string {
  return [
    'これは DeadStockSolution からの構造化タスクです。',
    'OpenClaw の既存 task 管理・coding workflow・PR 自動化フローに載せて処理してください。',
    '初回応答では、受領確認・現在の進め方・次のアクションを短く返してください。',
    'task envelope:',
    JSON.stringify(task, null, 2),
  ].join('\n\n');
}
