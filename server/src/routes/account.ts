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

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 100) {
        res.status(400).json({ error: '薬局名は1〜100文字で入力してください' });
        return;
      }
      updates.name = name.trim();
    }

    if (postalCode !== undefined) {
      if (typeof postalCode !== 'string') {
        res.status(400).json({ error: '郵便番号が不正です' });
        return;
      }
      const normalized = postalCode.replace(/[-ー－\s]/g, '');
      if (!/^\d{7}$/.test(normalized)) {
        res.status(400).json({ error: '郵便番号は7桁の数字で入力してください' });
        return;
      }
      updates.postalCode = normalized;
      const coords = postalCodeToCoordinates(normalized);
      if (coords) {
        updates.latitude = coords.lat;
        updates.longitude = coords.lng;
      }
    }

    if (address !== undefined) {
      if (typeof address !== 'string' || address.trim().length === 0 || address.trim().length > 255) {
        res.status(400).json({ error: '住所は1〜255文字で入力してください' });
        return;
      }
      updates.address = address.trim();
    }

    if (phone !== undefined) {
      if (typeof phone !== 'string' || phone.trim().length === 0 || phone.trim().length > 30) {
        res.status(400).json({ error: '電話番号が不正です' });
        return;
      }
      updates.phone = phone.trim();
    }

    if (fax !== undefined) {
      if (typeof fax !== 'string' || fax.trim().length === 0 || fax.trim().length > 30) {
        res.status(400).json({ error: 'FAX番号が不正です' });
        return;
      }
      updates.fax = fax.trim();
    }

    if (prefecture !== undefined) {
      if (typeof prefecture !== 'string' || prefecture.trim().length === 0 || prefecture.trim().length > 10) {
        res.status(400).json({ error: '都道府県が不正です' });
        return;
      }
      updates.prefecture = prefecture.trim();
    }

    if (newPassword !== undefined && newPassword !== '') {
      if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 100) {
        res.status(400).json({ error: '新しいパスワードは8〜100文字で入力してください' });
        return;
      }

      if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
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

    const [updatedPharmacy] = await db.select({
      id: pharmacies.id,
      email: pharmacies.email,
      isAdmin: pharmacies.isAdmin,
      isActive: pharmacies.isActive,
    })
      .from(pharmacies)
      .where(eq(pharmacies.id, req.user!.id))
      .limit(1);

    if (!updatedPharmacy || !updatedPharmacy.isActive) {
      res.clearCookie('token');
      res.status(401).json({ error: 'アカウントが無効です。再度ログインしてください' });
      return;
    }

    // Regenerate token from current DB state
    const token = generateToken({
      id: updatedPharmacy.id,
      email: updatedPharmacy.email,
      isAdmin: updatedPharmacy.isAdmin ?? false,
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
