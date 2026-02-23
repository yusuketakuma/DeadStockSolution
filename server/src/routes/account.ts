import { Router, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies } from '../db/schema';
import { hashPassword, verifyPassword, generateToken } from '../services/auth-service';
import { requireLogin } from '../middleware/auth';
import { postalCodeToCoordinates } from '../utils/postal-code';
import { AuthRequest } from '../types';

const router = Router();

router.get('/', requireLogin, async (req: AuthRequest, res: Response) => {
  try {
    const rows = await db.select({
      id: pharmacies.id,
      email: pharmacies.email,
      name: pharmacies.name,
      postalCode: pharmacies.postalCode,
      address: pharmacies.address,
      phone: pharmacies.phone,
      fax: pharmacies.fax,
      licenseNumber: pharmacies.licenseNumber,
      prefecture: pharmacies.prefecture,
      isAdmin: pharmacies.isAdmin,
      createdAt: pharmacies.createdAt,
    })
      .from(pharmacies)
      .where(eq(pharmacies.id, req.user!.id))
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({ error: 'アカウントが見つかりません' });
      return;
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('Get account error:', err);
    res.status(500).json({ error: 'アカウント情報の取得に失敗しました' });
  }
});

router.put('/', requireLogin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, postalCode, address, phone, fax, prefecture, currentPassword, newPassword } = req.body;

    const updates: Record<string, unknown> = {};

    if (name) updates.name = name;
    if (postalCode) {
      const normalized = postalCode.replace(/[-ー－\s]/g, '');
      updates.postalCode = normalized;
      const coords = postalCodeToCoordinates(normalized);
      if (coords) {
        updates.latitude = coords.lat;
        updates.longitude = coords.lng;
      }
    }
    if (address) updates.address = address;
    if (phone) updates.phone = phone;
    if (fax) updates.fax = fax;
    if (prefecture) updates.prefecture = prefecture;

    if (newPassword) {
      if (!currentPassword) {
        res.status(400).json({ error: '現在のパスワードを入力してください' });
        return;
      }

      const rows = await db.select({ passwordHash: pharmacies.passwordHash })
        .from(pharmacies)
        .where(eq(pharmacies.id, req.user!.id))
        .limit(1);

      const valid = await verifyPassword(currentPassword, rows[0].passwordHash);
      if (!valid) {
        res.status(400).json({ error: '現在のパスワードが正しくありません' });
        return;
      }

      updates.passwordHash = await hashPassword(newPassword);
    }

    updates.updatedAt = new Date().toISOString();

    await db.update(pharmacies)
      .set(updates)
      .where(eq(pharmacies.id, req.user!.id));

    // Regenerate token if needed
    const token = generateToken({
      id: req.user!.id,
      email: req.user!.email,
      isAdmin: req.user!.isAdmin,
    });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.json({ message: 'アカウント情報を更新しました' });
  } catch (err) {
    console.error('Update account error:', err);
    res.status(500).json({ error: 'アカウント更新に失敗しました' });
  }
});

router.delete('/', requireLogin, async (req: AuthRequest, res: Response) => {
  try {
    await db.update(pharmacies)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(pharmacies.id, req.user!.id));

    res.clearCookie('token');
    res.json({ message: 'アカウントを無効化しました' });
  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({ error: 'アカウント削除に失敗しました' });
  }
});

export default router;
