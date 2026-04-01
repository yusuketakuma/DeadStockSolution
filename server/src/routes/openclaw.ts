import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { and, eq, ne } from 'drizzle-orm';
import { db } from '../config/database';
import { userRequests } from '../db/schema';
import { invalidateAuthUserCache } from '../middleware/auth';
import { logger } from '../services/logger';
import { createNotification } from '../services/notification-service';
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
} from '../services/openclaw';
import {
  ensureOpenClawWorkItem,
  isOpenClawWorkflowStatus,
  mapOpenClawStatusToWorkflowStatus,
  recordOpenClawRequestMessage,
  updateOpenClawWorkItem,
  type OpenClawWorkflowStatus,
} from '../services/openclaw/thread-service';
import {
  publishAdminRequestsRefresh,
  publishRequestsRefresh,
} from '../services/realtime-service';
import { recordOpenClawRequestEvent } from '../services/openclaw/request-event-service';
import { completeOpenClawRetryForRequest } from '../services/openclaw/retry-service';
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

function normalizeWorkflowStatus(value: unknown): OpenClawWorkflowStatus | null {
  if (!isOpenClawWorkflowStatus(value)) {
    return null;
  }
  return value;
}

type OpenClawReportKind = 'question' | 'analysis' | 'status_update' | 'pr_opened' | 'completed' | 'failed';

function isOpenClawReportKind(value: unknown): value is OpenClawReportKind {
  return value === 'question'
    || value === 'analysis'
    || value === 'status_update'
    || value === 'pr_opened'
    || value === 'completed'
    || value === 'failed';
}

function resolveStatusFromWorkflowStatus(workflowStatus: OpenClawWorkflowStatus): OpenClawStatus {
  if (workflowStatus === 'implementing' || workflowStatus === 'pr_opened') {
    return 'implementing';
  }
  if (workflowStatus === 'completed') {
    return 'completed';
  }
  return 'in_dialogue';
}

function resolveNonRegressingOpenClawStatus(
  currentStatus: OpenClawStatus,
  workflowStatus: OpenClawWorkflowStatus,
): OpenClawStatus {
  const desiredStatus = resolveStatusFromWorkflowStatus(workflowStatus);
  return canTransitionOpenClawStatus(currentStatus, desiredStatus)
    ? desiredStatus
    : currentStatus;
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
        error: '状態遷移が不正です',
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

    let notificationToCreate: Parameters<typeof createNotification>[0] | null = null;

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
          await recordOpenClawRequestEvent({
            requestId,
            pharmacyId: current.pharmacyId,
            eventType: 'status_updated',
            fromStatus: current.openclawStatus,
            toStatus: status,
            threadId,
            summary,
            note: 'OpenClaw callback により状態を更新しました',
          }, tx);
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
          await recordOpenClawRequestEvent({
            requestId,
            pharmacyId: current.pharmacyId,
            eventType: 'status_updated',
            fromStatus: current.openclawStatus,
            toStatus: status,
            threadId,
            summary,
            note: 'OpenClaw callback により完了状態を再反映しました',
          }, tx);
          return;
        }

        const summaryText = summary ?? current.openclawSummary;
        await recordOpenClawRequestEvent({
          requestId,
          pharmacyId: current.pharmacyId,
          eventType: 'status_updated',
          fromStatus: current.openclawStatus,
          toStatus: status,
          threadId,
          summary: summaryText,
          note: 'OpenClaw callback により状態を更新しました',
        }, tx);
        notificationToCreate = {
          pharmacyId: current.pharmacyId,
          type: 'request_update',
          title: 'ご要望の対応が完了しました',
          message: summaryText
            ? `要望 #${requestId}: ${summaryText}`
            : `要望 #${requestId} の対応が完了しました。管理画面で詳細をご確認ください。`,
          referenceType: 'request',
          referenceId: requestId,
          detailJson: {
            source: 'openclaw_callback',
            status,
          },
        };
      });
    } catch (err) {
      releaseOpenClawWebhookReplay({
        receivedSignature: signature,
        receivedTimestamp: timestamp,
      });
      throw err;
    }

    await ensureOpenClawWorkItem({
      requestId,
      pharmacyId: current.pharmacyId,
      workflowStatus: mapOpenClawStatusToWorkflowStatus(status),
      latestSummary: summary ?? current.openclawSummary ?? null,
    });

    await updateOpenClawWorkItem({
      requestId,
      workflowStatus: mapOpenClawStatusToWorkflowStatus(status),
      latestSummary: summary ?? current.openclawSummary ?? null,
    });

    const isDuplicateCompletedCallback = status === 'completed'
      && current.openclawStatus === 'completed'
      && current.openclawSummary === summary;

    if (summary && !isDuplicateCompletedCallback) {
      await recordOpenClawRequestMessage({
        requestId,
        authorType: 'system',
        messageType: 'status_update',
        body: summary,
        metadata: {
          status,
          threadId: threadId ?? current.openclawThreadId ?? null,
          implementationBranch: reportedBranch ?? getOpenClawImplementationBranch(),
        },
      });
    }

    await completeOpenClawRetryForRequest(requestId);

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

    if (notificationToCreate) {
      await createNotification(notificationToCreate);
    }

    publishRequestsRefresh({
      pharmacyId: current.pharmacyId,
      requestId,
      reason: 'openclaw_callback',
    });
    publishAdminRequestsRefresh({
      requestId,
      reason: 'openclaw_callback',
    });
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

router.post('/report', callbackLimiter, async (req, res: Response) => {
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

    if (!isAuthorized || isOpenClawWebhookReplay({ receivedSignature: signature, receivedTimestamp: timestamp })) {
      res.status(401).json({ error: 'OpenClaw webhook 認証に失敗しました' });
      return;
    }

    const requestId = parseRequestId(req.body.requestId);
    const kind = req.body.kind;
    const message = normalizeText(req.body.message, 4000);
    const workflowStatus = normalizeWorkflowStatus(req.body.workflowStatus);
    const threadId = normalizeText(req.body.threadId, 120);
    const summary = normalizeText(req.body.summary, 4000);
    const branchName = normalizeText(req.body.branchName, 120);
    const prUrl = normalizeText(req.body.prUrl, 500);
    const prNumber = isPositiveSafeInteger(req.body.prNumber) ? Number(req.body.prNumber) : null;

    if (!requestId || !isOpenClawReportKind(kind) || !message) {
      res.status(400).json({ error: 'requestId, kind, message が不正です' });
      return;
    }

    if ((kind === 'pr_opened' || workflowStatus === 'implementing' || workflowStatus === 'pr_opened')
      && !isImplementationBranchAllowed(branchName)) {
      res.status(409).json({ error: '許可されていない実装ブランチです' });
      return;
    }

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

    if (!consumeOpenClawWebhookReplay({ receivedSignature: signature, receivedTimestamp: timestamp })) {
      res.status(401).json({ error: 'OpenClaw webhook 認証に失敗しました' });
      return;
    }

    const nextWorkflowStatus = workflowStatus
      ?? (kind === 'question'
        ? 'awaiting_user'
        : kind === 'pr_opened'
          ? 'pr_opened'
          : kind === 'completed'
            ? 'completed'
            : kind === 'failed'
              ? 'failed'
              : 'analyzing');

    const nextOpenClawStatus = resolveNonRegressingOpenClawStatus(current.openclawStatus, nextWorkflowStatus);
    const nextSummary = summary ?? message;
    const isDuplicateCompletedReport = kind === 'completed'
      && current.openclawStatus === 'completed'
      && current.openclawSummary === nextSummary;
    let notificationToCreate: Parameters<typeof createNotification>[0] | null = null;

    try {
      await db.transaction(async (tx) => {
        await tx.update(userRequests)
          .set({
            openclawStatus: nextOpenClawStatus,
            openclawThreadId: threadId ?? current.openclawThreadId,
            openclawSummary: nextSummary,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(userRequests.id, requestId));

        if (kind === 'completed' && current.openclawStatus !== 'completed') {
          notificationToCreate = {
            pharmacyId: current.pharmacyId,
            type: 'request_update',
            title: 'ご要望の対応が完了しました',
            message: summary
              ? `要望 #${requestId}: ${summary}`
              : `要望 #${requestId} の対応が完了しました。管理画面で詳細をご確認ください。`,
            referenceType: 'request',
            referenceId: requestId,
            detailJson: {
              source: 'openclaw_report',
              kind,
              workflowStatus: nextWorkflowStatus,
            },
          };
        } else if (kind === 'failed') {
          notificationToCreate = {
            pharmacyId: current.pharmacyId,
            type: 'request_update',
            title: 'ご要望対応で確認が必要です',
            message: `要望 #${requestId}: ${message}`,
            referenceType: 'request',
            referenceId: requestId,
            detailJson: {
              source: 'openclaw_report',
              kind,
              workflowStatus: nextWorkflowStatus,
            },
          };
        }
      });
    } catch (err) {
      releaseOpenClawWebhookReplay({ receivedSignature: signature, receivedTimestamp: timestamp });
      throw err;
    }

    await ensureOpenClawWorkItem({
      requestId,
      pharmacyId: current.pharmacyId,
      workflowStatus: nextWorkflowStatus,
      latestSummary: nextSummary,
    });

    await updateOpenClawWorkItem({
      requestId,
      workflowStatus: nextWorkflowStatus,
      latestSummary: nextSummary,
      lastQuestion: kind === 'question' ? message : undefined,
      branchName: branchName ?? undefined,
      prUrl: prUrl ?? undefined,
      prNumber: prNumber ?? undefined,
      lastError: kind === 'failed' ? message : undefined,
      metadata: {
        kind,
        threadId: threadId ?? current.openclawThreadId ?? null,
      },
    });

    if (!isDuplicateCompletedReport) {
      const completionNotificationCreated = notificationToCreate !== null && kind === 'completed';
      await recordOpenClawRequestMessage({
        requestId,
        authorType: kind === 'completed' || kind === 'failed' ? 'system' : 'openclaw_agent',
        messageType: kind === 'question' ? 'question' : kind === 'pr_opened' ? 'pr_report' : 'status_update',
        body: message,
        metadata: {
          kind,
          workflowStatus: nextWorkflowStatus,
          threadId: threadId ?? current.openclawThreadId ?? null,
          branchName,
          prUrl,
          prNumber,
          completionNotificationCreated,
        },
      });
    }

    if (notificationToCreate) {
      await createNotification(notificationToCreate);
    }

    publishRequestsRefresh({
      pharmacyId: current.pharmacyId,
      requestId,
      reason: 'openclaw_report',
    });
    publishAdminRequestsRefresh({
      requestId,
      reason: 'openclaw_report',
    });
    res.json({
      message: 'OpenClawレポートを反映しました',
      requestId,
      workflowStatus: nextWorkflowStatus,
      openclawStatus: nextOpenClawStatus,
    });
  } catch (err) {
    logger.error('OpenClaw report error', { error: (err as Error).message });
    res.status(500).json({ error: 'OpenClawレポート処理に失敗しました' });
  }
});

export default router;
