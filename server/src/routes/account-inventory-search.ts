import { Router, Response } from 'express';
import { requireLogin } from '../middleware/auth';
import { logger } from '../services/logger';
import { getErrorMessage } from '../middleware/error-handler';
import { sendBadRequest } from './response-helpers';
import type { AuthRequest } from '../types';
import type {
  InventorySearchDraftUpdatePayload,
  InventorySearchHistoryUpdatePayload,
  InventorySearchPresetsUpdatePayload,
} from '../../../shared/inventory-search-preferences.js';
import {
  inventorySearchDraftUpdateSchema,
  inventorySearchHistoryUpdateSchema,
  inventorySearchPreferencesSchema,
  inventorySearchPresetsUpdateSchema,
} from '../../../shared/inventory-search-preferences.js';
import {
  loadInventorySearchPreferences,
  saveInventorySearchPreferences,
  saveUpdatedInventorySearchPreferences,
} from '../services/inventory-search-preferences-service';

const router = Router();

function sendInventorySearchConflict(res: Response, latestData: unknown): void {
  res.status(409).json({
    error: '検索条件が別の画面で更新されました。最新の条件を確認してください',
    latestData,
  });
}

router.get('/inventory-search-preferences', requireLogin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const preferences = await loadInventorySearchPreferences(req.user!.id);
    res.json(preferences);
  } catch (err) {
    logger.error('Get inventory search preferences error', {
      error: getErrorMessage(err),
    });
    res.status(500).json({ error: '検索条件の取得に失敗しました' });
  }
});

router.put('/inventory-search-preferences', requireLogin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = inventorySearchPreferencesSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendBadRequest(res, parsed.error.issues[0]?.message ?? '検索条件の形式が不正です');
      return;
    }

    const result = await saveInventorySearchPreferences(req.user!.id, parsed.data);
    if (result.ok) {
      res.json({ message: '検索条件を保存しました', version: result.version });
      return;
    }

    sendInventorySearchConflict(res, result.latestData);
  } catch (err) {
    logger.error('Update inventory search preferences error', {
      error: getErrorMessage(err),
    });
    res.status(500).json({ error: '検索条件の保存に失敗しました' });
  }
});

router.put('/inventory-search-preferences/draft', requireLogin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = inventorySearchDraftUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendBadRequest(res, parsed.error.issues[0]?.message ?? '検索条件の形式が不正です');
      return;
    }

    const payload: InventorySearchDraftUpdatePayload = parsed.data;
    const result = await saveUpdatedInventorySearchPreferences(req.user!.id, payload, (current) => ({
      ...current,
      version: payload.version,
      draft: payload.draft,
    }));

    if (result.ok) {
      res.json({ message: '検索条件を保存しました', version: result.version });
      return;
    }

    sendInventorySearchConflict(res, result.latestData);
  } catch (err) {
    logger.error('Update inventory search draft error', {
      error: getErrorMessage(err),
    });
    res.status(500).json({ error: '検索条件の保存に失敗しました' });
  }
});

router.put('/inventory-search-preferences/history', requireLogin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = inventorySearchHistoryUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendBadRequest(res, parsed.error.issues[0]?.message ?? '検索履歴の形式が不正です');
      return;
    }

    const payload: InventorySearchHistoryUpdatePayload = parsed.data;
    const result = await saveUpdatedInventorySearchPreferences(req.user!.id, payload, (current) => ({
      ...current,
      version: payload.version,
      searchHistory: payload.searchHistory,
    }));

    if (result.ok) {
      res.json({ message: '検索履歴を保存しました', version: result.version });
      return;
    }

    sendInventorySearchConflict(res, result.latestData);
  } catch (err) {
    logger.error('Update inventory search history error', {
      error: getErrorMessage(err),
    });
    res.status(500).json({ error: '検索履歴の保存に失敗しました' });
  }
});

router.put('/inventory-search-preferences/presets', requireLogin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = inventorySearchPresetsUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendBadRequest(res, parsed.error.issues[0]?.message ?? '保存済み検索の形式が不正です');
      return;
    }

    const payload: InventorySearchPresetsUpdatePayload = parsed.data;
    const result = await saveUpdatedInventorySearchPreferences(req.user!.id, payload, (current) => ({
      ...current,
      version: payload.version,
      savedPresets: payload.savedPresets,
    }));

    if (result.ok) {
      res.json({ message: '保存済み検索を保存しました', version: result.version });
      return;
    }

    sendInventorySearchConflict(res, result.latestData);
  } catch (err) {
    logger.error('Update inventory search presets error', {
      error: getErrorMessage(err),
    });
    res.status(500).json({ error: '保存済み検索の保存に失敗しました' });
  }
});

export default router;
