import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { and, eq, ne } from 'drizzle-orm';
import { db } from '../config/database';
import { userRequests, notifications } from '../db/schema';
import { invalidateAuthUserCache } from '../middleware/auth';
import { logger } from '../services/logger';
import { processVerificationCallback } from '../services/pharmacy-verification-callback-service';
import { isVerificationRequestType } from '../services/pharmacy-verification-service';
import {
  canTransitionOpenClawStatus,
  consumeOpenClawWebhookReplay,
  getOpenClawImplementationBranch,
  isImplementationBranchAllowed,
  isOpenClawWebhookReplay,
  isOpenClawStatus,
  isOpenClawWebhookConfigured,
  releaseOpenClawWebhookReplay,
  verifyOpenClawWebhookSignature,
  type OpenClawStatus,
} from '../services/openclaw-service';
import { isPositiveSafeInteger, parsePositiveInt } from '../utils/request-utils';

const router = Router();
const callbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'リクエストが多すぎます。時間をおいて再試行してください' },
});

function parseRequestId(rawValue: unknown): number | null {
  if (isPositiveSafeInteger(rawValue)) {
    return rawValue;
  }
  return parsePositiveInt(String(rawValue ?? ''));
}

function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function parseJsonObject(rawValue: string | null | undefined): Record<string, unknown> | null {
  if (typeof rawValue !== 'string') {
    return null;
  }

  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

router.post('/callback', callbackLimiter, async (req, res: Response) => {
  try {
    if (!isOpenClawWebhookConfigured()) {
      res.status(503).json({ error: 'OpenClaw webhook が未設定です' });
      return;
    }

    const signature = req.header('x-openclaw-signature');
    const timestamp = req.header('x-openclaw-timestamp');
    const isAuthorized = verifyOpenClawWebhookSignature({
      receivedSignature: signature,
      receivedTimestamp: timestamp,
      rawBody: req.rawBody,
    });

    if (!isAuthorized) {
      res.status(401).json({ error: 'OpenClaw webhook 認証に失敗しました' });
      return;
    }

    if (isOpenClawWebhookReplay({
      receivedSignature: signature,
      receivedTimestamp: timestamp,
    })) {
      res.status(401).json({ error: 'OpenClaw webhook 認証に失敗しました' });
      return;
    }

    const requestId = parseRequestId(req.body.requestId);
    const statusRaw = req.body.status;
    if (!requestId || !isOpenClawStatus(statusRaw)) {
      res.status(400).json({ error: 'requestId または status が不正です' });
      return;
    }
    const status = statusRaw as OpenClawStatus;

    const reportedBranch = normalizeText(req.body.implementationBranch, 120);
    if ((status === 'implementing' || status === 'completed') && !isImplementationBranchAllowed(reportedBranch)) {
      res.status(409).json({
        error: '許可されていない実装ブランチです',
      });
      return;
    }

    const threadId = normalizeText(req.body.threadId, 120);
    const summary = normalizeText(req.body.summary, 4000);

    const [current] = await db.select({
      id: userRequests.id,
      pharmacyId: userRequests.pharmacyId,
      openclawStatus: userRequests.openclawStatus,
      openclawThreadId: userRequests.openclawThreadId,
      openclawSummary: userRequests.openclawSummary,
      requestText: userRequests.requestText,
    })
      .from(userRequests)
      .where(eq(userRequests.id, requestId))
      .limit(1);

    if (!current) {
      res.status(404).json({ error: '対象の要望が見つかりません' });
      return;
    }

    if (!canTransitionOpenClawStatus(current.openclawStatus, status)) {
      res.status(409).json({
        error: `状態遷移が不正です。現在: ${current.openclawStatus}, 受信: ${status}`,
      });
      return;
    }

    const replayAccepted = consumeOpenClawWebhookReplay({
      receivedSignature: signature,
      receivedTimestamp: timestamp,
    });
    if (!replayAccepted) {
      res.status(401).json({ error: 'OpenClaw webhook 認証に失敗しました' });
      return;
    }

    try {
      await db.transaction(async (tx) => {
        const updatePayload = {
          openclawStatus: status,
          openclawThreadId: threadId ?? current.openclawThreadId,
          openclawSummary: summary ?? current.openclawSummary,
          updatedAt: new Date().toISOString(),
        };

        if (status !== 'completed') {
          await tx.update(userRequests)
            .set(updatePayload)
            .where(eq(userRequests.id, requestId));
          return;
        }

        const transitionedRows = await tx.update(userRequests)
          .set(updatePayload)
          .where(and(
            eq(userRequests.id, requestId),
            ne(userRequests.openclawStatus, 'completed'),
          ))
          .returning({ id: userRequests.id });

        if (transitionedRows.length === 0) {
          await tx.update(userRequests)
            .set(updatePayload)
            .where(eq(userRequests.id, requestId));
          return;
        }

        const summaryText = summary ?? current.openclawSummary;
        await tx.insert(notifications).values({
          pharmacyId: current.pharmacyId,
          type: 'request_update',
          title: 'ご要望の対応が完了しました',
          message: summaryText
            ? `要望 #${requestId}: ${summaryText}`
            : `要望 #${requestId} の対応が完了しました。管理画面で詳細をご確認ください。`,
          referenceType: 'request',
          referenceId: requestId,
        });
      });
    } catch (err) {
      releaseOpenClawWebhookReplay({
        receivedSignature: signature,
        receivedTimestamp: timestamp,
      });
      throw err;
    }

    // Process pharmacy verification callback if applicable
    if (status === 'completed') {
      try {
        const requestContent = parseJsonObject(current.requestText);
        if (requestContent && isVerificationRequestType(requestContent.type)) {
          const verificationData = parseJsonObject(summary);
          if (!verificationData || typeof verificationData.approved !== 'boolean') {
            logger.warn('Skipped pharmacy verification callback due to invalid summary payload', {
              requestId,
              pharmacyId: current.pharmacyId,
              summaryProvided: Boolean(summary),
            });
          } else {
            const callbackResult = await processVerificationCallback({
              pharmacyId: current.pharmacyId,
              requestId,
              approved: verificationData.approved,
              reason: typeof verificationData.reason === 'string' ? verificationData.reason : '',
            });
            if (callbackResult.applied) {
              invalidateAuthUserCache(current.pharmacyId);
            }
          }
        }
      } catch (verificationErr) {
        logger.error('Pharmacy verification callback processing failed', {
          requestId,
          pharmacyId: current.pharmacyId,
          error: verificationErr instanceof Error ? verificationErr.message : String(verificationErr),
        });
        // Don't fail the whole callback - the OpenClaw status was already updated
      }
    }

    res.json({
      message: 'OpenClawコールバックを反映しました',
      requestId,
      openclawStatus: status,
      implementationBranch: reportedBranch ?? getOpenClawImplementationBranch(),
    });
  } catch (err) {
    logger.error('OpenClaw callback error', { error: (err as Error).message });
    res.status(500).json({ error: 'OpenClawコールバック処理に失敗しました' });
  }
});

export default router;
