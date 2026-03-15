import { Response, NextFunction } from 'express';
import { eq, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies } from '../db/schema';
import { deriveSessionVersion, isJwtSecretMissingError, verifyToken } from '../services/auth-service';
import { isDependencyServiceUnavailableError } from '../routes/auth-helpers';
import { AuthRequest } from '../types';
import { VerificationStatus } from '../services/pharmacy-verification-service';

interface CachedAuthUser {
  id: number;
  email: string;
  isAdmin: boolean;
  isActive: boolean;
  sessionVersion: string;
  verificationStatus: VerificationStatus;
  rejectionReason: string | null;
  expiresAt: number;
}

const DEFAULT_AUTH_USER_CACHE_TTL_MS = 5_000;
const MAX_AUTH_USER_CACHE_TTL_MS = 60_000;
const MAX_AUTH_USER_CACHE_ENTRIES = 5_000;
const CACHE_SWEEP_INTERVAL_WRITES = 128;
const parsedAuthUserCacheTtl = Number(process.env.AUTH_USER_CACHE_TTL_MS ?? DEFAULT_AUTH_USER_CACHE_TTL_MS);
const AUTH_USER_CACHE_TTL_MS = Number.isFinite(parsedAuthUserCacheTtl) && parsedAuthUserCacheTtl >= 0
  ? Math.min(parsedAuthUserCacheTtl, MAX_AUTH_USER_CACHE_TTL_MS)
  : DEFAULT_AUTH_USER_CACHE_TTL_MS;

const authUserCache = new Map<number, CachedAuthUser>();
let authUserCacheWrites = 0;

type AuthUserRow = {
  id: number;
  email: string;
  isAdmin: boolean | null;
  isActive: boolean;
  passwordHash: string;
  verificationStatus: string | null;
  rejectionReason: string | null;
};

type PreparedPharmacyAuthUserById = {
  execute(params: { pharmacyId: number }): Promise<AuthUserRow[]>;
};

let prepared_pharmacy_auth_user_by_id: PreparedPharmacyAuthUserById | null = null;

function bindParam<T>(name: string): T {
  const placeholderFn = (sql as typeof sql & { placeholder?: (placeholderName: string) => unknown }).placeholder;
  if (typeof placeholderFn === 'function') {
    return placeholderFn(name) as T;
  }
  return name as T;
}

function getPreparedPharmacyAuthUserById(): PreparedPharmacyAuthUserById | null {
  const placeholderFn = (sql as (typeof sql | undefined) & { placeholder?: unknown })?.placeholder;
  if (process.env.NODE_ENV === 'test' || typeof placeholderFn !== 'function') return null;
  if (prepared_pharmacy_auth_user_by_id) return prepared_pharmacy_auth_user_by_id;
  const query = db.select({
    id: pharmacies.id,
    email: pharmacies.email,
    isAdmin: pharmacies.isAdmin,
    isActive: pharmacies.isActive,
    passwordHash: pharmacies.passwordHash,
    verificationStatus: pharmacies.verificationStatus,
    rejectionReason: pharmacies.rejectionReason,
  })
    .from(pharmacies)
    .where(eq(pharmacies.id, bindParam<number>('pharmacyId')))
    .limit(1);
  if (typeof (query as { prepare?: unknown }).prepare === 'function') {
    prepared_pharmacy_auth_user_by_id = (query as { prepare(name: string): PreparedPharmacyAuthUserById })
      .prepare('prepared_pharmacy_auth_user_by_id');
  }
  return prepared_pharmacy_auth_user_by_id;
}

function isAuthUserCacheEnabled(): boolean {
  return process.env.NODE_ENV !== 'test' && AUTH_USER_CACHE_TTL_MS > 0;
}

function getCachedAuthUser(userId: number): CachedAuthUser | null {
  if (!isAuthUserCacheEnabled()) return null;
  const cached = authUserCache.get(userId);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    authUserCache.delete(userId);
    return null;
  }
  // LRU: delete + re-insert で Map 末尾へ移動（最近使用済みに）
  authUserCache.delete(userId);
  authUserCache.set(userId, cached);
  return cached;
}

function sweepExpiredAuthUsers(now: number = Date.now()): void {
  for (const [userId, cached] of authUserCache) {
    if (cached.expiresAt <= now) {
      authUserCache.delete(userId);
    }
  }
}

function enforceAuthUserCacheLimit(): void {
  if (authUserCache.size <= MAX_AUTH_USER_CACHE_ENTRIES) return;
  sweepExpiredAuthUsers();
  while (authUserCache.size > MAX_AUTH_USER_CACHE_ENTRIES) {
    const oldestUserId = authUserCache.keys().next().value;
    if (oldestUserId === undefined) break;
    authUserCache.delete(oldestUserId);
  }
}

function cacheAuthUser(user: { id: number; email: string; isAdmin: boolean; isActive: boolean; sessionVersion: string; verificationStatus: VerificationStatus; rejectionReason: string | null }): void {
  if (!isAuthUserCacheEnabled()) return;
  authUserCacheWrites += 1;
  if (authUserCacheWrites % CACHE_SWEEP_INTERVAL_WRITES === 0) {
    sweepExpiredAuthUsers();
  }
  authUserCache.set(user.id, {
    ...user,
    expiresAt: Date.now() + AUTH_USER_CACHE_TTL_MS,
  });
  enforceAuthUserCacheLimit();
}

export function invalidateAuthUserCache(userId: number): void {
  authUserCache.delete(userId);
}

export function clearAuthUserCacheForTests(): void {
  authUserCache.clear();
  authUserCacheWrites = 0;
}

function sendInactiveAccountResponse(res: Response, verificationStatus: VerificationStatus | null, rejectionReason: string | null): void {
  if (verificationStatus === 'pending_verification') {
    res.status(403).json({ error: '審査中です', verificationStatus: 'pending_verification' });
  } else if (verificationStatus === 'rejected') {
    res.status(403).json({ error: '却下されました', verificationStatus: 'rejected', rejectionReason });
  } else {
    res.status(401).json({ error: 'アカウントが無効です' });
  }
}

function sendInvalidSessionResponse(res: Response): void {
  res.status(401).json({ error: 'セッションが無効です。再度ログインしてください' });
}

function sendAuthConfigurationResponse(res: Response): void {
  res.status(503).json({ error: '認証設定が未完了です。管理者に連絡してください' });
}

function assignAuthenticatedUser(req: AuthRequest, user: Pick<CachedAuthUser, 'id' | 'email' | 'isAdmin'>): void {
  req.user = {
    id: user.id,
    email: user.email,
    isAdmin: user.isAdmin,
  };
}

export async function requireLogin(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.token;

  if (!token) {
    res.status(401).json({ error: 'ログインが必要です' });
    return;
  }

  let payload: ReturnType<typeof verifyToken>;
  try {
    payload = verifyToken(token);
  } catch (err) {
    if (isJwtSecretMissingError(err)) {
      sendAuthConfigurationResponse(res);
      return;
    }
    sendInvalidSessionResponse(res);
    return;
  }
  if (typeof payload.sessionVersion !== 'string' || payload.sessionVersion.length === 0) {
    sendInvalidSessionResponse(res);
    return;
  }

  try {
    const cached = getCachedAuthUser(payload.id);
    if (cached) {
      if (cached.sessionVersion !== payload.sessionVersion) {
        sendInvalidSessionResponse(res);
        return;
      }
      if (!cached.isActive) {
        sendInactiveAccountResponse(res, cached.verificationStatus, cached.rejectionReason);
        return;
      }
      assignAuthenticatedUser(req, cached);
      next();
      return;
    }

    const prepared = getPreparedPharmacyAuthUserById();
    const rows = prepared
      ? await prepared.execute({ pharmacyId: payload.id })
      : await db.select({
        id: pharmacies.id,
        email: pharmacies.email,
        isAdmin: pharmacies.isAdmin,
        isActive: pharmacies.isActive,
        passwordHash: pharmacies.passwordHash,
        verificationStatus: pharmacies.verificationStatus,
        rejectionReason: pharmacies.rejectionReason,
      })
        .from(pharmacies)
        .where(eq(pharmacies.id, payload.id))
        .limit(1);

    if (rows.length === 0) {
      res.status(401).json({ error: 'アカウントが無効です。再度ログインしてください' });
      return;
    }
    if (!rows[0].isActive) {
      sendInactiveAccountResponse(res, rows[0].verificationStatus as VerificationStatus, rows[0].rejectionReason);
      return;
    }
    const sessionVersion = deriveSessionVersion(rows[0].passwordHash);
    if (sessionVersion !== payload.sessionVersion) {
      sendInvalidSessionResponse(res);
      return;
    }

    cacheAuthUser({
      id: rows[0].id,
      email: rows[0].email,
      isAdmin: rows[0].isAdmin ?? false,
      isActive: rows[0].isActive,
      sessionVersion,
      verificationStatus: rows[0].verificationStatus as VerificationStatus,
      rejectionReason: rows[0].rejectionReason,
    });

    assignAuthenticatedUser(req, {
      id: rows[0].id,
      email: rows[0].email,
      isAdmin: rows[0].isAdmin ?? false,
    });

    next();
  } catch (err) {
    if (isJwtSecretMissingError(err)) {
      sendAuthConfigurationResponse(res);
      return;
    }
    if (isDependencyServiceUnavailableError(err)) {
      res.status(503).json({ error: '認証サービスが一時的に利用できません。しばらくしてから再試行してください' });
      return;
    }
    res.status(500).json({ error: '認証処理中にエラーが発生しました' });
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user?.isAdmin) {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }
  next();
}
