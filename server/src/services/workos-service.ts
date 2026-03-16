import { WorkOS } from '@workos-inc/node';
import { eq } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { db } from '../config/database';
import { pharmacies } from '../db/schema';
import { eqEmailCaseInsensitive } from '../utils/email-utils';
import { logger } from './logger';

let workosInstance: WorkOS | null = null;

function getWorkOS(): WorkOS {
  if (!workosInstance) {
    const apiKey = process.env.WORKOS_API_KEY;
    if (!apiKey) {
      throw new Error('WORKOS_API_KEY environment variable is not set');
    }
    workosInstance = new WorkOS(apiKey);
  }
  return workosInstance;
}

export function getClientId(): string {
  const clientId = process.env.WORKOS_CLIENT_ID;
  if (!clientId) {
    throw new Error('WORKOS_CLIENT_ID environment variable is not set');
  }
  return clientId;
}

function getRedirectUri(): string {
  const uri = process.env.WORKOS_REDIRECT_URI;
  if (!uri) {
    throw new Error('WORKOS_REDIRECT_URI environment variable is not set');
  }
  return uri;
}

export function getAuthorizationUrl(screenHint?: 'sign-up' | 'sign-in'): string {
  const workos = getWorkOS();
  const url = workos.userManagement.getAuthorizationUrl({
    provider: 'authkit',
    clientId: getClientId(),
    redirectUri: getRedirectUri(),
    screenHint,
  });
  return url;
}

export interface WorkOSAuthResult {
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    emailVerified: boolean;
  };
  accessToken: string;
  refreshToken: string;
}

export async function authenticateWithCode(code: string): Promise<WorkOSAuthResult> {
  const workos = getWorkOS();
  const result = await workos.userManagement.authenticateWithCode({
    code,
    clientId: getClientId(),
  });

  return {
    user: {
      id: result.user.id,
      email: result.user.email,
      firstName: result.user.firstName,
      lastName: result.user.lastName,
      emailVerified: result.user.emailVerified,
    },
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
  };
}

export async function findPharmacyByWorkosUserId(workosUserId: string) {
  const rows = await db.select()
    .from(pharmacies)
    .where(eq(pharmacies.workosUserId, workosUserId))
    .limit(1);
  return rows.length > 0 ? rows[0] : null;
}

export async function findPharmacyByEmailForLinking(email: string) {
  const rows = await db.select()
    .from(pharmacies)
    .where(eqEmailCaseInsensitive(pharmacies.email, email))
    .limit(1);
  return rows.length > 0 ? rows[0] : null;
}

export async function linkWorkosUserToPharmacy(pharmacyId: number, workosUserId: string): Promise<void> {
  await db.update(pharmacies)
    .set({ workosUserId, updatedAt: new Date().toISOString() })
    .where(eq(pharmacies.id, pharmacyId));
}

export async function findOrLinkPharmacy(workosUser: WorkOSAuthResult['user']): Promise<{
  pharmacy: typeof pharmacies.$inferSelect | null;
  isNewUser: boolean;
}> {
  // 1. workosUserId で検索
  const existingByWorkos = await findPharmacyByWorkosUserId(workosUser.id);
  if (existingByWorkos) {
    return { pharmacy: existingByWorkos, isNewUser: false };
  }

  // 2. email で検索して自動リンク（emailVerified 必須）
  if (!workosUser.emailVerified) {
    logger.warn('WorkOS user email not verified, skipping auto-link', {
      workosUserId: workosUser.id,
      email: workosUser.email,
    });
    return { pharmacy: null, isNewUser: true };
  }

  const existingByEmail = await findPharmacyByEmailForLinking(workosUser.email);
  if (existingByEmail) {
    await linkWorkosUserToPharmacy(existingByEmail.id, workosUser.id);
    logger.info('Linked WorkOS user to existing pharmacy', {
      pharmacyId: existingByEmail.id,
      workosUserId: workosUser.id,
    });
    return { pharmacy: { ...existingByEmail, workosUserId: workosUser.id }, isNewUser: false };
  }

  // 3. 新規ユーザー（薬局未登録）
  return { pharmacy: null, isNewUser: true };
}

export async function createWorkosUser(
  email: string,
  firstName: string,
  password: string,
): Promise<string> {
  const workos = getWorkOS();
  const user = await workos.userManagement.createUser({
    email,
    password,
    firstName,
    emailVerified: true,
  });
  return user.id;
}

export async function createPasswordReset(email: string): Promise<string> {
  const workos = getWorkOS();
  const result = await workos.userManagement.createPasswordReset({ email });
  return result.id;
}

/**
 * Onboarding トークン: WorkOS 認証済み・薬局未登録ユーザー用の短期JWT。
 * 通常の JwtPayload (id > 0) とは異なり、workosUserId + email のみを保持する。
 */
export interface OnboardingClaims {
  workosUserId: string;
  email: string;
}

const ONBOARDING_TOKEN_PREFIX = 'onboarding:';

export function generateOnboardingToken(claims: OnboardingClaims): string {
  const secret = process.env.JWT_SECRET || 'test-secret-only';
  return jwt.sign(
    { sub: ONBOARDING_TOKEN_PREFIX + claims.workosUserId, email: claims.email },
    secret,
    { expiresIn: '30m', algorithm: 'HS256' },
  );
}

export function verifyOnboardingToken(token: string): OnboardingClaims | null {
  try {
    const secret = process.env.JWT_SECRET || 'test-secret-only';
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as { sub?: string; email?: string };
    if (typeof decoded.sub !== 'string' || !decoded.sub.startsWith(ONBOARDING_TOKEN_PREFIX)) return null;
    if (typeof decoded.email !== 'string' || decoded.email.trim().length === 0) return null;
    return {
      workosUserId: decoded.sub.slice(ONBOARDING_TOKEN_PREFIX.length),
      email: decoded.email,
    };
  } catch {
    return null;
  }
}

// テスト用: WorkOS インスタンスをリセット
export function resetWorkOSInstance(): void {
  workosInstance = null;
}
