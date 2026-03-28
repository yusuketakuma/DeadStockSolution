import { Router, Response } from 'express';
import { requireLogin } from '../middleware/auth';
import { AuthRequest } from '../types';
import * as proposalTemplateService from '../services/proposal-template-service';
import { logger } from '../services/logger';

const router = Router();
router.use(requireLogin);

function parseTemplateId(value: string | undefined): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// ── GET / — テンプレート一覧 ──────────────────────────────────

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const pharmacyId = req.user!.id;
    const templates = await proposalTemplateService.listTemplates(pharmacyId);
    res.json(templates);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('List proposal templates error', { error: message });
    res.status(500).json({ error: 'テンプレート一覧の取得に失敗しました' });
  }
});

// ── POST / — 提案IDからテンプレート作成 ──────────────────────────────────

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const pharmacyId = req.user!.id;
    const { proposalId, name } = req.body as { proposalId?: unknown; name?: unknown };

    const parsedProposalId = Number(proposalId);
    if (!Number.isInteger(parsedProposalId) || parsedProposalId <= 0) {
      res.status(400).json({ error: '不正な提案IDです' });
      return;
    }

    if (typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'テンプレート名を入力してください' });
      return;
    }

    if (name.trim().length > 100) {
      res.status(400).json({ error: 'テンプレート名は100文字以内で入力してください' });
      return;
    }

    const template = await proposalTemplateService.createTemplateFromProposal(
      pharmacyId,
      parsedProposalId,
      name.trim(),
    );
    res.status(201).json(template);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (
      message.includes('見つかりません') ||
      message.includes('権限がありません') ||
      message.includes('完了済みの提案')
    ) {
      res.status(400).json({ error: message });
      return;
    }

    logger.error('Create proposal template error', { error: message });
    res.status(500).json({ error: 'テンプレートの作成に失敗しました' });
  }
});

// ── DELETE /:id — テンプレート削除 ──────────────────────────────────

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const templateId = parseTemplateId(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
    if (!templateId) {
      res.status(400).json({ error: '不正なIDです' });
      return;
    }

    const pharmacyId = req.user!.id;
    await proposalTemplateService.deleteTemplate(pharmacyId, templateId);
    res.status(204).send();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes('見つかりません') || message.includes('権限がありません')) {
      res.status(404).json({ error: message });
      return;
    }

    logger.error('Delete proposal template error', { error: message });
    res.status(500).json({ error: 'テンプレートの削除に失敗しました' });
  }
});

// ── POST /:id/use — テンプレート利用回数を記録 ──────────────────────────────────

router.post('/:id/use', async (req: AuthRequest, res: Response) => {
  try {
    const templateId = parseTemplateId(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
    if (!templateId) {
      res.status(400).json({ error: '不正なIDです' });
      return;
    }

    const pharmacyId = req.user!.id;
    const template = await proposalTemplateService.recordTemplateUse(pharmacyId, templateId);
    res.json(template);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes('見つかりません')) {
      res.status(404).json({ error: message });
      return;
    }

    if (message.includes('権限がありません')) {
      res.status(403).json({ error: message });
      return;
    }

    logger.error('Use proposal template error', { error: message });
    res.status(500).json({ error: 'テンプレート利用の記録に失敗しました' });
  }
});

export default router;
