import { Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies } from '../db/schema';
import { verifyToken } from '../services/auth-service';
import { AuthRequest } from '../types';

export async function requireLogin(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.token;

  if (!token) {
    res.status(401).json({ error: 'ログインが必要です' });
    return;
  }

  try {
    const payload = verifyToken(token);

    const rows = await db.select({
      id: pharmacies.id,
      email: pharmacies.email,
      isAdmin: pharmacies.isAdmin,
      isActive: pharmacies.isActive,
    })
      .from(pharmacies)
      .where(eq(pharmacies.id, payload.id))
      .limit(1);

    if (rows.length === 0 || !rows[0].isActive) {
      res.status(401).json({ error: 'アカウントが無効です。再度ログインしてください' });
      return;
    }

    req.user = {
      id: rows[0].id,
      email: rows[0].email,
      isAdmin: rows[0].isAdmin ?? false,
    };

    next();
  } catch {
    res.status(401).json({ error: 'セッションが無効です。再度ログインしてください' });
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user?.isAdmin) {
    res.status(403).json({ error: '管理者権限が必要です' });
    return;
  }
  next();
}
