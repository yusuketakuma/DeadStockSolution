import { Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies } from '../db/schema';
import { deriveSessionVersion, verifyToken } from '../services/auth-service';
import { AuthRequest } from '../types';

interface CachedAuthUser {
  id: number;
  email: string;
  isAdmin: boolean;
  isActive: boolean;
  sessionVersion: string;
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

function cacheAuthUser(user: { id: number; email: string; isAdmin: boolean; isActive: boolean; sessionVersion: string }): void {
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

export async function requireLogin(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.token;

  if (!token) {
    res.status(401).json({ error: 'ログインが必要です' });
    return;
  }

  let payload: ReturnType<typeof verifyToken>;
  try {
    payload = verifyToken(token);
  } catch {
    res.status(401).json({ error: 'セッションが無効です。再度ログインしてください' });
    return;
  }
  if (typeof payload.sessionVersion !== 'string' || payload.sessionVersion.length === 0) {
    res.status(401).json({ error: 'セッションが無効です。再度ログインしてください' });
    return;
  }

  try {
    const cached = getCachedAuthUser(payload.id);
    if (cached) {
      if (!cached.isActive || cached.sessionVersion !== payload.sessionVersion) {
        res.status(401).json({ error: 'アカウントが無効です。再度ログインしてください' });
        return;
      }
      req.user = {
        id: cached.id,
        email: cached.email,
        isAdmin: cached.isAdmin,
      };
      next();
      return;
    }

    const rows = await db.select({
      id: pharmacies.id,
      email: pharmacies.email,
      isAdmin: pharmacies.isAdmin,
      isActive: pharmacies.isActive,
      passwordHash: pharmacies.passwordHash,
    })
      .from(pharmacies)
      .where(eq(pharmacies.id, payload.id))
      .limit(1);

    if (rows.length === 0 || !rows[0].isActive) {
      res.status(401).json({ error: 'アカウントが無効です。再度ログインしてください' });
      return;
    }
    const sessionVersion = deriveSessionVersion(rows[0].passwordHash);
    if (sessionVersion !== payload.sessionVersion) {
      res.status(401).json({ error: 'セッションが無効です。再度ログインしてください' });
      return;
    }

    cacheAuthUser({
      id: rows[0].id,
      email: rows[0].email,
      isAdmin: rows[0].isAdmin ?? false,
      isActive: rows[0].isActive,
      sessionVersion,
    });

    req.user = {
      id: rows[0].id,
      email: rows[0].email,
      isAdmin: rows[0].isAdmin ?? false,
    };

    next();
  } catch {
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
