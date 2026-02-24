import crypto from 'crypto';
import { eq, and, gt, lt, isNull } from 'drizzle-orm';
import { db } from '../config/database';
import { passwordResetTokens, pharmacies } from '../db/schema';
import { hashPassword } from './auth-service';

const TOKEN_EXPIRY_MINUTES = 30;
const MAX_ACTIVE_TOKENS_PER_USER = 3;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateResetToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function createPasswordResetToken(email: string): Promise<{ token: string; pharmacyName: string } | null> {
  const rows = await db.select({ id: pharmacies.id, name: pharmacies.name, isActive: pharmacies.isActive })
    .from(pharmacies)
    .where(eq(pharmacies.email, email))
    .limit(1);

  if (rows.length === 0 || !rows[0].isActive) {
    return null;
  }

  // Rate limit: check active token count per user
  const existingTokens = await db.select({ id: passwordResetTokens.id })
    .from(passwordResetTokens)
    .where(and(
      eq(passwordResetTokens.pharmacyId, rows[0].id),
      isNull(passwordResetTokens.usedAt),
      gt(passwordResetTokens.expiresAt, new Date().toISOString()),
    ));

  if (existingTokens.length >= MAX_ACTIVE_TOKENS_PER_USER) {
    return null;
  }

  const token = generateResetToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000).toISOString();

  await db.insert(passwordResetTokens).values({
    pharmacyId: rows[0].id,
    token: tokenHash,
    expiresAt,
  });

  // Clean up expired tokens
  const cutoff = new Date().toISOString();
  await db.delete(passwordResetTokens).where(
    and(
      eq(passwordResetTokens.pharmacyId, rows[0].id),
      lt(passwordResetTokens.expiresAt, cutoff),
    )
  );

  return { token, pharmacyName: rows[0].name };
}

export async function resetPasswordWithToken(token: string, newPassword: string): Promise<boolean> {
  const now = new Date().toISOString();
  const tokenHash = hashToken(token);

  const rows = await db.select({
    id: passwordResetTokens.id,
    pharmacyId: passwordResetTokens.pharmacyId,
    expiresAt: passwordResetTokens.expiresAt,
  })
    .from(passwordResetTokens)
    .where(and(
      eq(passwordResetTokens.token, tokenHash),
      isNull(passwordResetTokens.usedAt),
      gt(passwordResetTokens.expiresAt, now),
    ))
    .limit(1);

  if (rows.length === 0) {
    return false;
  }

  const resetRecord = rows[0];
  const passwordHash = await hashPassword(newPassword);

  await db.transaction(async (tx) => {
    // Invalidate ALL unused tokens for this user (not just the used one)
    await tx.update(passwordResetTokens)
      .set({ usedAt: new Date().toISOString() })
      .where(and(
        eq(passwordResetTokens.pharmacyId, resetRecord.pharmacyId),
        isNull(passwordResetTokens.usedAt),
      ));

    await tx.update(pharmacies)
      .set({ passwordHash, updatedAt: new Date().toISOString() })
      .where(eq(pharmacies.id, resetRecord.pharmacyId));
  });

  return true;
}
