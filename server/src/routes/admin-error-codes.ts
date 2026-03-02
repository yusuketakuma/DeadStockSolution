import { Router, Response } from 'express';
import { requireLogin, requireAdmin } from '../middleware/auth';
import { listErrorCodes, createErrorCode, updateErrorCode } from '../services/error-code-service';
import { errorCodeCategoryValues, errorCodeSeverityValues, type ErrorCodeCategory, type ErrorCodeSeverity } from '../db/schema';
import { AuthRequest } from '../types';
import { handleAdminError, parseIdOrBadRequest } from './admin-utils';

const router = Router();
router.use(requireLogin);
router.use(requireAdmin);

const validCategories = new Set<string>(errorCodeCategoryValues);
const validSeverities = new Set<string>(errorCodeSeverityValues);

// GET /api/admin/error-codes
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const options: {
      category?: ErrorCodeCategory;
      severity?: ErrorCodeSeverity;
      search?: string;
      activeOnly?: boolean;
    } = {};

    if (req.query.category && validCategories.has(String(req.query.category))) {
      options.category = String(req.query.category) as ErrorCodeCategory;
    }
    if (req.query.severity && validSeverities.has(String(req.query.severity))) {
      options.severity = String(req.query.severity) as ErrorCodeSeverity;
    }
    if (req.query.search) options.search = String(req.query.search);
    if (req.query.activeOnly !== 'false') options.activeOnly = true;

    const result = await listErrorCodes(options);
    res.json(result);
  } catch (err) {
    handleAdminError(err, 'Admin error-codes list error', 'エラーコード一覧の取得に失敗しました', res);
  }
});

// POST /api/admin/error-codes
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { code, category, severity, titleJa, descriptionJa, resolutionJa } = req.body;
    if (!code || !category || !severity || !titleJa) {
      res.status(400).json({ error: '必須項目が不足しています' });
      return;
    }
    const created = await createErrorCode({ code, category, severity, titleJa, descriptionJa, resolutionJa });
    if (!created) {
      res.status(500).json({ error: 'エラーコードの作成に失敗しました' });
      return;
    }
    res.status(201).json(created);
  } catch (err) {
    handleAdminError(err, 'Admin error-codes create error', 'エラーコードの作成に失敗しました', res);
  }
});

// PUT /api/admin/error-codes/:id
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseIdOrBadRequest(res, req.params.id);
    if (!id) return;
    const updated = await updateErrorCode(id, req.body);
    if (!updated) {
      res.status(404).json({ error: 'エラーコードが見つかりません' });
      return;
    }
    res.json(updated);
  } catch (err) {
    handleAdminError(err, 'Admin error-codes update error', 'エラーコードの更新に失敗しました', res);
  }
});

export default router;
