import crypto from 'crypto';
import { eq, and, gt, isNull } from 'drizzle-orm';
import { db } from '../config/database';
import { passwordResetTokens, pharmacies } from '../db/schema';
import { hashPassword } from './auth-service';

const TOKEN_EXPIRY_MINUTES = 30;

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

  const token = generateResetToken();
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000).toISOString();

  await db.insert(passwordResetTokens).values({
    pharmacyId: rows[0].id,
    token,
    expiresAt,
  });

  return { token, pharmacyName: rows[0].name };
}

export async function resetPasswordWithToken(token: string, newPassword: string): Promise<boolean> {
  const now = new Date().toISOString();

  const rows = await db.select({
    id: passwordResetTokens.id,
    pharmacyId: passwordResetTokens.pharmacyId,
    expiresAt: passwordResetTokens.expiresAt,
  })
    .from(passwordResetTokens)
    .where(and(
      eq(passwordResetTokens.token, token),
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
    await tx.update(passwordResetTokens)
      .set({ usedAt: new Date().toISOString() })
      .where(eq(passwordResetTokens.id, resetRecord.id));

    await tx.update(pharmacies)
      .set({ passwordHash, updatedAt: new Date().toISOString() })
      .where(eq(pharmacies.id, resetRecord.pharmacyId));
  });

  return true;
}
