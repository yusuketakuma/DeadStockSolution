import { Router, Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import { adminWriteLimiter } from './admin-write-limiter';
import {
  createDrugEquivalence,
  getDrugEquivalenceById,
  listDrugEquivalences,
  updateDrugEquivalence,
  deleteDrugEquivalence,
  DrugEquivalenceValidationError,
  DrugEquivalenceDuplicateError,
} from '../services/drug-equivalence-service';
import { logger } from '../services/logger';

const router = Router();

const equivalenceTypeEnum = z.enum(['brand_generic', 'generic_generic']);

const createSchema = z.object({
  drugNameA: z.string().min(1),
  drugNameB: z.string().min(1),
  equivalenceType: equivalenceTypeEnum,
  notes: z.string().optional(),
}).strict();

const updateSchema = z.object({
  drugNameA: z.string().min(1).optional(),
  drugNameB: z.string().min(1).optional(),
  equivalenceType: equivalenceTypeEnum.optional(),
  notes: z.string().nullable().optional(),
}).strict();

function parseIdParam(idStr: string | string[]): number | null {
  if (Array.isArray(idStr)) return null;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id < 1) return null;
  return id;
}

router.get('/drug-equivalences', async (req: AuthRequest, res: Response) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    const data = await listDrugEquivalences({ limit, offset });
    res.json({ data });
  } catch (err) {
    logger.error('Admin drug equivalences list error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: '薬品同等性一覧の取得に失敗しました' });
  }
});

router.get('/drug-equivalences/:id', async (req: AuthRequest, res: Response) => {
  const id = parseIdParam(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'IDが不正です' });
    return;
  }

  try {
    const data = await getDrugEquivalenceById(id);
    if (!data) {
      res.status(404).json({ error: '指定された薬品同等性が見つかりません' });
      return;
    }
    res.json({ data });
  } catch (err) {
    logger.error('Admin drug equivalence fetch error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: '薬品同等性の取得に失敗しました' });
  }
});

router.post('/drug-equivalences', adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    res.status(400).json({ error: issue?.message ?? 'リクエスト形式が不正です' });
    return;
  }

  try {
    const data = await createDrugEquivalence(parsed.data);
    res.status(201).json({ data });
  } catch (err) {
    if (err instanceof DrugEquivalenceValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof DrugEquivalenceDuplicateError) {
      res.status(409).json({ error: err.message });
      return;
    }
    logger.error('Admin drug equivalence create error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: '薬品同等性の登録に失敗しました' });
  }
});

router.put('/drug-equivalences/:id', adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  const id = parseIdParam(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'IDが不正です' });
    return;
  }

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    res.status(400).json({ error: issue?.message ?? 'リクエスト形式が不正です' });
    return;
  }

  try {
    const data = await updateDrugEquivalence(id, parsed.data);
    if (!data) {
      res.status(404).json({ error: '指定された薬品同等性が見つかりません' });
      return;
    }
    res.json({ data });
  } catch (err) {
    if (err instanceof DrugEquivalenceValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    logger.error('Admin drug equivalence update error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: '薬品同等性の更新に失敗しました' });
  }
});

router.delete('/drug-equivalences/:id', adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  const id = parseIdParam(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'IDが不正です' });
    return;
  }

  try {
    const deleted = await deleteDrugEquivalence(id);
    if (!deleted) {
      res.status(404).json({ error: '指定された薬品同等性が見つかりません' });
      return;
    }
    res.json({ message: '薬品同等性を削除しました' });
  } catch (err) {
    logger.error('Admin drug equivalence delete error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: '薬品同等性の削除に失敗しました' });
  }
});

export default router;
