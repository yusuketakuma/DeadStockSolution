import { eq } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies, userRequests } from '../db/schema';
import { handoffToOpenClaw } from './openclaw-service';
import { logger } from './logger';
import { isPositiveSafeInteger } from '../utils/request-utils';
import { getErrorMessage } from '../middleware/error-handler';

export type VerificationStatus = 'pending_verification' | 'verified' | 'rejected';
export const PHARMACY_VERIFICATION_REQUEST_TYPE = 'pharmacy_verification';
export const PHARMACY_REVERIFICATION_REQUEST_TYPE = 'pharmacy_reverification';
export type PharmacyVerificationRequestType =
  | typeof PHARMACY_VERIFICATION_REQUEST_TYPE
  | typeof PHARMACY_REVERIFICATION_REQUEST_TYPE;

const VERIFICATION_REQUEST_TYPES = new Set<PharmacyVerificationRequestType>([
  PHARMACY_VERIFICATION_REQUEST_TYPE,
  PHARMACY_REVERIFICATION_REQUEST_TYPE,
]);

export function isVerificationRequestType(value: unknown): value is PharmacyVerificationRequestType {
  return typeof value === 'string' && VERIFICATION_REQUEST_TYPES.has(value as PharmacyVerificationRequestType);
}

const REVERIFICATION_FIELD_LIST = [
  'email', 'name', 'postalCode', 'address', 'phone', 'fax', 'licenseNumber', 'prefecture',
] as const;
export type ReverificationField = typeof REVERIFICATION_FIELD_LIST[number];

export function isVerified(status: VerificationStatus): boolean {
  return status === 'verified';
}

export function isPendingVerification(status: VerificationStatus): boolean {
  return status === 'pending_verification';
}

export function canLogin(_status: VerificationStatus, isActive: boolean): boolean {
  return isActive;
}

export function detectChangedReverificationFields(
  currentValues: Partial<Record<ReverificationField, unknown>>,
  updates: Record<string, unknown>,
): ReverificationField[] {
  const changed: ReverificationField[] = [];
  for (const field of REVERIFICATION_FIELD_LIST) {
    if (!(field in updates)) continue;
    if (!Object.is(currentValues[field], updates[field])) {
      changed.push(field);
    }
  }
  return changed;
}

export class ReverificationTriggerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReverificationTriggerError';
  }
}

export function sendReverificationTriggerErrorResponse(
  res: { status(code: number): { json(body: unknown): void } },
  errorMessage: string,
  latestVersion: number | null,
): void {
  res.status(503).json({
    error: errorMessage,
    partialSuccess: true,
    verificationStatus: 'pending_verification' as VerificationStatus,
    ...(latestVersion !== null ? { version: latestVersion } : {}),
  });
}

export interface ReverificationTriggerOptions {
  currentVerificationRequestId?: number | null;
  triggeredBy?: 'admin' | 'user';
}

export interface ReverificationTriggerResult {
  requestId: number;
  reusedExistingRequest: boolean;
}

/**
 * プロフィール変更時の再認証トリガー。
 * - user_requests にリクエスト投入
 * - pharmacies.verificationStatus を pending_verification に更新
 * - OpenClaw へのハンドオフは非同期で実行（API応答をブロックしない）
 */
export async function triggerReverification(
  pharmacyId: number,
  changedFields: string[],
  options: ReverificationTriggerOptions = {},
): Promise<ReverificationTriggerResult> {
  const { triggeredBy } = options;
  const requestPayload = {
    type: PHARMACY_REVERIFICATION_REQUEST_TYPE,
    changedFields,
    ...(triggeredBy ? { triggeredBy } : {}),
  } as const;
  const requestText = JSON.stringify(requestPayload);

  try {
    let requestId: number | null = null;
    let reusedExistingRequest = false;

    const currentReqId = options.currentVerificationRequestId;
    if (isPositiveSafeInteger(currentReqId)) {
      const [existingRequest] = await db.select({
        id: userRequests.id,
        requestText: userRequests.requestText,
        openclawStatus: userRequests.openclawStatus,
      })
        .from(userRequests)
        .where(eq(userRequests.id, currentReqId))
        .limit(1);

      if (
        existingRequest
        && existingRequest.requestText === requestText
        && existingRequest.openclawStatus !== 'completed'
      ) {
        requestId = existingRequest.id;
        reusedExistingRequest = true;
      }
    }

    if (requestId === null) {
      const [verificationRequest] = await db.insert(userRequests).values({
        pharmacyId,
        requestText,
      }).returning({ id: userRequests.id });

      if (!verificationRequest?.id) {
        throw new ReverificationTriggerError('再審査リクエストの作成に失敗しました');
      }
      requestId = verificationRequest.id;
    }

    await db.update(pharmacies)
      .set({
        verificationStatus: 'pending_verification',
        verificationRequestId: requestId,
      })
      .where(eq(pharmacies.id, pharmacyId));

    void handoffToOpenClaw({
      requestId,
      pharmacyId,
      requestText,
    }).then((handoffResult) => {
      if (!handoffResult.accepted) {
        logger.warn('Re-verification handoff was not accepted', {
          pharmacyId,
          requestId,
          note: handoffResult.note,
          reusedExistingRequest,
        });
      }
    }).catch((handoffErr: unknown) => {
      logger.error('Re-verification handoff failed', {
        pharmacyId,
        requestId,
        error: getErrorMessage(handoffErr),
      });
    });

    return {
      requestId,
      reusedExistingRequest,
    };
  } catch (err) {
    // DB層で失敗した場合でも fail-open を避けるため pending 状態へ寄せる。
    try {
      await db.update(pharmacies)
        .set({ verificationStatus: 'pending_verification' })
        .where(eq(pharmacies.id, pharmacyId));
    } catch (fallbackErr) {
      logger.error('Failed to enforce pending_verification fallback', {
        pharmacyId,
        error: getErrorMessage(fallbackErr),
      });
    }

    logger.error('Re-verification trigger failed', {
      pharmacyId,
      error: getErrorMessage(err),
      changedFields,
    });
    if (err instanceof ReverificationTriggerError) {
      throw err;
    }
    throw new ReverificationTriggerError('再審査依頼の登録に失敗しました');
  }
}
