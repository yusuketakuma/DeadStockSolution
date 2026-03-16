import { WorkOS } from '@workos-inc/node';
import { eq } from 'drizzle-orm';
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

  // 2. email で検索して自動リンク
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

// テスト用: WorkOS インスタンスをリセット
export function resetWorkOSInstance(): void {
  workosInstance = null;
}
