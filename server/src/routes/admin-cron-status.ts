import { Router, Response } from 'express';
import { and, eq, isNotNull, lt, max, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  dailyStatistics,
  exchangeProposals,
  deadStockItems,
  openclawRetryJobs,
} from '../db/schema';
import { AuthRequest } from '../types';
import { handleAdminError } from './admin-utils';

const router = Router();

/**
 * GET /api/admin/cron-status
 *
 * 各 CRON ジョブの最終実行状況を既存テーブルの証跡から返す。
 *
 * レスポンス例:
 * {
 *   "crons": [
 *     {
 *       "name": "daily_statistics",
 *       "label": "日次統計集計",
 *       "lastActivityAt": "2025-03-28T00:00:00Z",
 *       "evidenceNote": "daily_statistics テーブルの最終レコード作成日時"
 *     },
 *     ...
 *   ]
 * }
 */
router.get('/cron-status', async (_req: AuthRequest, res: Response) => {
  try {
    const [
      dailyStatsResult,
      proposalExpiryResult,
      deadStockArchiveResult,
      openclawRetriesResult,
    ] = await Promise.all([
      // daily_statistics: 最終レコード作成日時
      db
        .select({ lastAt: max(dailyStatistics.createdAt) })
        .from(dailyStatistics),

      // proposal_expiry: リマインダー送信 or 期限切れ自動却下の最終日時
      // sendExpiryReminders → expiryReminderSentAt 更新
      // expireStaleProposals → status='rejected' + expiresAt < now（auto-reject の証跡）
      db
        .select({
          lastReminder: max(exchangeProposals.expiryReminderSentAt),
          lastAutoExpiry: max(exchangeProposals.expiresAt),
        })
        .from(exchangeProposals)
        .where(
          sql`(${exchangeProposals.expiryReminderSentAt} IS NOT NULL)
              OR (${exchangeProposals.status} = 'rejected' AND ${exchangeProposals.expiresAt} IS NOT NULL AND ${exchangeProposals.expiresAt} < now())`,
        ),

      // dead_stock_archive: 期限切れアイテムのアーカイブ証跡
      // アーカイブ cron は expirationDateIso < today のアイテムを isAvailable=false にする
      // expirationDateIso でフィルタして upload-diff-service による非公開化と区別する
      db
        .select({ lastAt: max(deadStockItems.expirationDateIso) })
        .from(deadStockItems)
        .where(and(
          eq(deadStockItems.isAvailable, false),
          isNotNull(deadStockItems.expirationDateIso),
          lt(deadStockItems.expirationDateIso, sql`CURRENT_DATE::text`),
        )),

      // openclaw_retries: 最終試行日時
      db
        .select({ lastAt: max(openclawRetryJobs.lastAttemptAt) })
        .from(openclawRetryJobs)
        .where(isNotNull(openclawRetryJobs.lastAttemptAt)),
    ]);

    const crons = [
      {
        name: 'daily_statistics',
        label: '日次統計集計',
        lastActivityAt: dailyStatsResult[0]?.lastAt ?? null,
        evidenceNote: 'daily_statistics テーブルの最終レコード作成日時',
      },
      {
        name: 'proposal_expiry',
        label: '提案期限切れ処理',
        lastActivityAt: (() => {
          const r = proposalExpiryResult[0];
          const a = r?.lastReminder ?? null;
          const b = r?.lastAutoExpiry ?? null;
          if (!a && !b) return null;
          if (!a) return b;
          if (!b) return a;
          return a > b ? a : b;
        })(),
        evidenceNote: '最終リマインダー送信日時 or 最終自動却下の期限日時（対象提案がない日は記録されません）',
      },
      {
        name: 'dead_stock_archive',
        label: 'デッドストックアーカイブ',
        lastActivityAt: deadStockArchiveResult[0]?.lastAt ?? null,
        evidenceNote: '期限切れアイテム（expirationDateIso < today, isAvailable=false）の最終有効期限日',
      },
      {
        name: 'openclaw_retries',
        label: 'OpenClaw リトライ処理',
        lastActivityAt: openclawRetriesResult[0]?.lastAt ?? null,
        evidenceNote: 'openclaw_retry_jobs テーブルの最終試行日時',
      },
    ];

    res.json({ crons });
  } catch (err) {
    handleAdminError(err, 'Admin cron-status fetch error', 'CRON ステータスの取得に失敗しました', res);
  }
});

export default router;
