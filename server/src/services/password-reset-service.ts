import crypto from 'crypto';
import { eq, and, gt, lt, isNull, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { passwordResetTokens, pharmacies } from '../db/schema';
import { hashPassword } from './auth-service';
import { eqEmailCaseInsensitive } from '../utils/email-utils';

const TOKEN_EXPIRY_MINUTES = 30;
const MAX_ACTIVE_TOKENS_PER_USER = 3;
const PASSWORD_RESET_LOCK_NAMESPACE = 24011;

type PasswordResetTransaction = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

async function acquirePasswordResetLock(tx: PasswordResetTransaction, pharmacyId: number): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${PASSWORD_RESET_LOCK_NAMESPACE}, ${pharmacyId})`);
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateResetToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export interface PasswordResetResult {
  success: boolean;
  pharmacyId: number;
}

export async function createPasswordResetToken(email: string): Promise<{ token: string; pharmacyName: string } | null> {
  return db.transaction(async (tx) => {
    const [pharmacy] = await tx.select({ id: pharmacies.id, name: pharmacies.name, isActive: pharmacies.isActive })
      .from(pharmacies)
      .where(eqEmailCaseInsensitive(pharmacies.email, email))
      .limit(1);

    if (!pharmacy || !pharmacy.isActive) {
      return null;
    }

    // Serialize token issue/reset flows per pharmacy to avoid lock-order deadlocks.
    await acquirePasswordResetLock(tx, pharmacy.id);

    const nowIso = new Date().toISOString();

    // Cleanup first so expired tokens do not count against the issuance cap.
    await tx.delete(passwordResetTokens).where(
      and(
        eq(passwordResetTokens.pharmacyId, pharmacy.id),
        lt(passwordResetTokens.expiresAt, nowIso),
      )
    );

    const activeTokenCountRows = await tx.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count
      FROM password_reset_tokens
      WHERE pharmacy_id = ${pharmacy.id}
        AND used_at IS NULL
        AND expires_at > ${nowIso}
    `);

    const activeTokenCount = Number(activeTokenCountRows.rows[0]?.count ?? 0);
    if (activeTokenCount >= MAX_ACTIVE_TOKENS_PER_USER) {
      return null;
    }

    const token = generateResetToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000).toISOString();

    await tx.insert(passwordResetTokens).values({
      pharmacyId: pharmacy.id,
      token: tokenHash,
      expiresAt,
    });

    return { token, pharmacyName: pharmacy.name };
  });
}

export async function resetPasswordWithToken(token: string, newPassword: string): Promise<PasswordResetResult> {
  const now = new Date().toISOString();
  const tokenHash = hashToken(token);

  return db.transaction(async (tx) => {
    const [candidate] = await tx.select({
      pharmacyId: passwordResetTokens.pharmacyId,
    })
      .from(passwordResetTokens)
      .where(and(
        eq(passwordResetTokens.token, tokenHash),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, now),
      ))
      .limit(1);

    if (!candidate) {
      return { success: false, pharmacyId: 0 };
    }

    // Always take advisory lock before mutating token rows to avoid lock-order deadlocks.
    await acquirePasswordResetLock(tx, candidate.pharmacyId);

    // Atomically consume the provided token to prevent race-condition reuse.
    const [consumed] = await tx.update(passwordResetTokens)
      .set({ usedAt: now })
      .where(and(
        eq(passwordResetTokens.token, tokenHash),
        eq(passwordResetTokens.pharmacyId, candidate.pharmacyId),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, now),
      ))
      .returning({
        pharmacyId: passwordResetTokens.pharmacyId,
      });

    if (!consumed) {
      return { success: false, pharmacyId: 0 };
    }

    // Hash password only after token is confirmed valid (avoid CPU waste on invalid tokens).
    const passwordHash = await hashPassword(newPassword);

    // Invalidate ALL remaining unused tokens for this user.
    await tx.update(passwordResetTokens)
      .set({ usedAt: now })
      .where(and(
        eq(passwordResetTokens.pharmacyId, consumed.pharmacyId),
        isNull(passwordResetTokens.usedAt),
      ));

    await tx.update(pharmacies)
      .set({
        passwordHash,
        updatedAt: now,
      })
      .where(eq(pharmacies.id, consumed.pharmacyId));

    return { success: true, pharmacyId: consumed.pharmacyId };
  });
}
