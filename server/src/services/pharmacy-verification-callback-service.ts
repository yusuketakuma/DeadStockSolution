import { and, eq } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies } from '../db/schema';
import { logger } from './logger';
import type { VerificationStatus } from './pharmacy-verification-service';
import { isPositiveSafeInteger } from '../utils/request-utils';

interface VerificationCallbackInput {
  pharmacyId: number;
  requestId: number;
  approved: boolean;
  reason: string;
}

interface VerificationCallbackResult {
  verificationStatus: VerificationStatus;
  pharmacyId: number;
  applied: boolean;
}

export async function processVerificationCallback(
  input: VerificationCallbackInput,
): Promise<VerificationCallbackResult> {
  const { pharmacyId, requestId, approved, reason } = input;
  const now = new Date().toISOString();
  const verificationStatus: VerificationStatus = approved ? 'verified' : 'rejected';
  const useRequestIdGuard = isPositiveSafeInteger(requestId);

  const updatedRows = await db.update(pharmacies)
    .set({
      verificationStatus,
      isActive: approved,
      verifiedAt: approved ? now : null,
      rejectionReason: approved ? null : reason,
      updatedAt: now,
    })
    .where(useRequestIdGuard
      ? and(
        eq(pharmacies.id, pharmacyId),
        eq(pharmacies.verificationRequestId, requestId),
      )
      : eq(pharmacies.id, pharmacyId))
    .returning({ id: pharmacies.id });

  if (updatedRows.length === 0) {
    logger.warn('Skipped stale pharmacy verification callback', () => ({
      pharmacyId,
      requestId,
      verificationStatus,
      reason,
    }));
    return { verificationStatus, pharmacyId, applied: false };
  }

  logger.info('Pharmacy verification callback processed', () => ({
    pharmacyId,
    verificationStatus,
    approved,
    requestId,
  }));

  return { verificationStatus, pharmacyId, applied: true };
}
