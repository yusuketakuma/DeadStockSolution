import { eq } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies } from '../db/schema';
import { logger } from './logger';
import type { VerificationStatus } from './pharmacy-verification-service';

interface VerificationCallbackInput {
  pharmacyId: number;
  requestId: number;
  approved: boolean;
  reason: string;
}

interface VerificationCallbackResult {
  verificationStatus: VerificationStatus;
  pharmacyId: number;
}

export async function processVerificationCallback(
  input: VerificationCallbackInput,
): Promise<VerificationCallbackResult> {
  const { pharmacyId, approved, reason } = input;
  const now = new Date().toISOString();
  const verificationStatus: VerificationStatus = approved ? 'verified' : 'rejected';

  await db.update(pharmacies)
    .set({
      verificationStatus,
      isActive: approved,
      verifiedAt: approved ? now : null,
      rejectionReason: approved ? null : reason,
      updatedAt: now,
    })
    .where(eq(pharmacies.id, pharmacyId));

  logger.info('Pharmacy verification callback processed', () => ({
    pharmacyId,
    verificationStatus,
    approved,
  }));

  return { verificationStatus, pharmacyId };
}
