import { Router, Response } from 'express';
import { AuthRequest } from '../types';
import { acceptProposal, rejectProposal, completeProposal } from '../services/exchange-service';
import { writeLog, getClientIp } from '../services/log-service';
import { parseExchangeIdOrBadRequest } from './exchange-utils';

const router = Router();

function sanitizeProposalActionError(err: unknown): { status: number; message: string } {
  const message = err instanceof Error ? err.message : '';
  if (message.includes('見つかりません') || message.includes('アクセス権限')) {
    return { status: 404, message: 'マッチングが見つかりません' };
  }
  if (message.includes('状態が変更された')) {
    return { status: 409, message: '状態が変更されたため、再読み込みして再試行してください' };
  }
  return { status: 400, message: '操作に失敗しました' };
}

// Accept proposal
router.post('/proposals/:id/accept', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseExchangeIdOrBadRequest(res, req.params.id);
    if (!id) return;
    const newStatus = await acceptProposal(id, req.user!.id);
    const msg = newStatus === 'confirmed' ? '仮マッチングが確定しました' : '仮マッチングを承認しました（相手薬局の承認待ち）';
    void writeLog('proposal_accept', {
      pharmacyId: req.user!.id,
      detail: `proposalId=${id}|status=${newStatus}`,
      ipAddress: getClientIp(req),
    });
    res.json({ message: msg, status: newStatus });
  } catch (err) {
    const failure = sanitizeProposalActionError(err);
    res.status(failure.status).json({ error: failure.message });
  }
});

// Reject proposal
router.post('/proposals/:id/reject', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseExchangeIdOrBadRequest(res, req.params.id);
    if (!id) return;
    await rejectProposal(id, req.user!.id);
    void writeLog('proposal_reject', {
      pharmacyId: req.user!.id,
      detail: `proposalId=${id}|status=rejected`,
      ipAddress: getClientIp(req),
    });
    res.json({ message: '仮マッチングを拒否しました' });
  } catch (err) {
    const failure = sanitizeProposalActionError(err);
    res.status(failure.status).json({ error: failure.message });
  }
});

// Complete exchange
router.post('/proposals/:id/complete', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseExchangeIdOrBadRequest(res, req.params.id);
    if (!id) return;
    await completeProposal(id, req.user!.id);
    void writeLog('proposal_complete', {
      pharmacyId: req.user!.id,
      detail: `proposalId=${id}|status=completed`,
      ipAddress: getClientIp(req),
    });
    res.json({ message: '交換を完了しました' });
  } catch (err) {
    const failure = sanitizeProposalActionError(err);
    res.status(failure.status).json({ error: failure.message });
  }
});

export default router;
