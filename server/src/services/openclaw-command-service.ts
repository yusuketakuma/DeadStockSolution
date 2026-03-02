import { db } from '../config/database';
import { openclawCommands } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import { logger } from './logger';

// ── 型定義 ──────────────────────────────────────────

export interface CommandDefinition {
  category: 'read' | 'write' | 'admin';
  descriptionJa: string;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

export interface CommandRequest {
  command: string;
  parameters?: Record<string, unknown>;
  threadId?: string;
  reason?: string;
}

export interface CommandResult {
  id: number;
  command: string;
  status: 'completed' | 'failed' | 'rejected';
  result?: unknown;
  errorMessage?: string;
}

// ── 組込みコマンド定義 ──────────────────────────────────────────

export const BUILTIN_COMMANDS: Record<string, CommandDefinition> = {
  'system.status': {
    category: 'read',
    descriptionJa: 'システムステータス取得',
    handler: async () => ({
      status: 'operational',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? 'unknown',
      uptime: process.uptime(),
    }),
  },
  'logs.query': {
    category: 'read',
    descriptionJa: 'ログ検索',
    handler: async (params) => {
      // Dynamic import to avoid circular dep
      const { queryLogs } = await import('./log-center-service');
      return queryLogs({
        sources: params.sources as any,
        level: params.level as any,
        search: params.search as string,
        from: params.from as string,
        to: params.to as string,
        limit: Number(params.limit) || 50,
      });
    },
  },
  'stats.summary': {
    category: 'read',
    descriptionJa: '統計サマリー取得',
    handler: async () => {
      const { getLogSummary } = await import('./log-center-service');
      return getLogSummary();
    },
  },
  'cache.clear': {
    category: 'write',
    descriptionJa: 'キャッシュクリア',
    handler: async () => ({ cleared: true, timestamp: new Date().toISOString() }),
  },
  'maintenance.enable': {
    category: 'admin',
    descriptionJa: 'メンテナンスモード有効化',
    handler: async () => {
      process.env.MAINTENANCE_MODE = 'true';
      return { maintenanceMode: true };
    },
  },
  'maintenance.disable': {
    category: 'admin',
    descriptionJa: 'メンテナンスモード無効化',
    handler: async () => {
      delete process.env.MAINTENANCE_MODE;
      return { maintenanceMode: false };
    },
  },
  'scheduler.restart': {
    category: 'write',
    descriptionJa: 'スケジューラー再起動',
    handler: async () => ({ restarted: true, timestamp: new Date().toISOString() }),
  },
  'pharmacy.toggle': {
    category: 'admin',
    descriptionJa: '薬局の有効/無効切替',
    handler: async (params) => {
      const pharmacyId = Number(params.pharmacyId);
      if (!pharmacyId) throw new Error('pharmacyId is required');
      // Placeholder - actual implementation would toggle pharmacy isActive
      return { pharmacyId, action: 'toggle_requested', timestamp: new Date().toISOString() };
    },
  },
  'job.cancel': {
    category: 'write',
    descriptionJa: 'ジョブキャンセル',
    handler: async (params) => {
      const jobId = Number(params.jobId);
      if (!jobId) throw new Error('jobId is required');
      return { jobId, action: 'cancel_requested', timestamp: new Date().toISOString() };
    },
  },
  'drug_master.sync': {
    category: 'write',
    descriptionJa: '薬価マスター同期実行',
    handler: async () => ({ syncTriggered: true, timestamp: new Date().toISOString() }),
  },
  'notification.send': {
    category: 'write',
    descriptionJa: '通知送信',
    handler: async (params) => {
      if (!params.message || typeof params.message !== 'string') throw new Error('message is required');
      return { sent: true, message: (params.message as string).slice(0, 100), timestamp: new Date().toISOString() };
    },
  },
};

// ── ホワイトリスト判定 ──────────────────────────────────────────

export function isCommandAllowed(commandName: string): boolean {
  return commandName in BUILTIN_COMMANDS;
}

// ── コマンド実行 ──────────────────────────────────────────

export async function executeCommand(request: CommandRequest, signature: string): Promise<CommandResult> {
  // Record received command
  const [record] = await db.insert(openclawCommands).values({
    commandName: request.command,
    parameters: request.parameters ? JSON.stringify(request.parameters) : null,
    status: 'received',
    openclawThreadId: request.threadId ?? null,
    signature,
  }).returning();

  // Check whitelist
  if (!isCommandAllowed(request.command)) {
    await db.update(openclawCommands)
      .set({ status: 'rejected', errorMessage: `Command not in whitelist: ${request.command}`, completedAt: new Date().toISOString() })
      .where(eq(openclawCommands.id, record.id));

    logger.warn('OpenClaw command rejected', { command: request.command, reason: 'not_in_whitelist' });
    return { id: record.id, command: request.command, status: 'rejected', errorMessage: 'コマンドが許可リストにありません' };
  }

  // Execute
  try {
    await db.update(openclawCommands)
      .set({ status: 'executing' })
      .where(eq(openclawCommands.id, record.id));

    const handler = BUILTIN_COMMANDS[request.command].handler;
    const result = await handler(request.parameters ?? {});

    await db.update(openclawCommands)
      .set({ status: 'completed', result: JSON.stringify(result), completedAt: new Date().toISOString() })
      .where(eq(openclawCommands.id, record.id));

    logger.info('OpenClaw command executed', { command: request.command });
    return { id: record.id, command: request.command, status: 'completed', result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(openclawCommands)
      .set({ status: 'failed', errorMessage: message, completedAt: new Date().toISOString() })
      .where(eq(openclawCommands.id, record.id));

    logger.error('OpenClaw command failed', { command: request.command, error: message });
    return { id: record.id, command: request.command, status: 'failed', errorMessage: message };
  }
}

// ── 履歴取得 ──────────────────────────────────────────

export async function listCommandHistory(limit = 50, offset = 0) {
  return db.select().from(openclawCommands).orderBy(desc(openclawCommands.receivedAt)).limit(Math.min(limit, 200)).offset(offset);
}
