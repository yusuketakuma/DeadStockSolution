import { Router, Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import * as groupService from '../services/group-service';
import type { GroupCursor, GroupListTab } from '../services/group-service';
import { logger } from '../services/logger';
import { parsePositiveInt, normalizeSearchTerm } from '../utils/request-utils';
import { parseCursor } from '../utils/cursor-pagination';

const router = Router();

// ── Zod Schemas ──────────────────────────────────

const CreateGroupBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  visibility: z.enum(['public', 'invite_only']),
});

const UpdateGroupBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  visibility: z.enum(['public', 'invite_only']).optional(),
});

const InviteBody = z.object({
  pharmacyId: z.number().int().positive(),
});

// ── Error mapping ──────────────────────────────────

function mapErrorToStatus(message: string): number {
  if (message.includes('見つかりません')) return 404;
  if (message.includes('のみ') || message.includes('権限') || message.includes('ではありません') || message.includes('できません')) return 403;
  if (message.includes('既に')) return 409;
  return 500;
}

function parseGroupId(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function respondInvalidId(res: Response): void {
  res.status(400).json({ error: '不正なIDです' });
}

function handleRouteError(res: Response, logMessage: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(logMessage, { error: message });
  const status = mapErrorToStatus(message);
  res.status(status).json({ error: status >= 500 ? 'グループ操作に失敗しました' : message });
}

function parseGroupCursor(raw: unknown) {
  return parseCursor<GroupCursor>(raw, (c) =>
    typeof c.createdAt === 'string' && Number.isFinite(Date.parse(c.createdAt)),
  );
}

function parseGroupTab(raw: unknown): GroupListTab | undefined {
  if (raw !== 'mine' && raw !== 'public') {
    return undefined;
  }
  return raw;
}

// ── POST / — グループ作成 ──────────────────────────────────

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const parsed = CreateGroupBody.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      res.status(400).json({ error: issue?.message ?? 'リクエスト形式が不正です' });
      return;
    }
    const result = await groupService.createGroup(req.user!.id, parsed.data);
    res.status(201).json(result);
  } catch (err) {
    handleRouteError(res, 'Create group error', err);
  }
});

// ── GET / — グループ一覧 ──────────────────────────────────

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const limit = parsePositiveInt(req.query.limit) ?? undefined;
    const offset = parsePositiveInt(req.query.offset) ?? undefined;
    const search = normalizeSearchTerm(req.query.search);
    const tab = parseGroupTab(Array.isArray(req.query.tab) ? req.query.tab[0] : req.query.tab);

    const cursor = parseGroupCursor(req.query.cursor);
    if (cursor === null) {
      res.status(400).json({ error: 'cursorが不正です' });
      return;
    }

    const result = await groupService.listGroups(req.user!.id, { limit, offset, search, cursor, tab });
    res.json(result);
  } catch (err) {
    handleRouteError(res, 'List groups error', err);
  }
});

// ── GET /membership-summary — 自分が所属するグループと参加薬局一覧 ──────────────────────────────────

router.get('/membership-summary', async (req: AuthRequest, res: Response) => {
  try {
    const result = await groupService.getMembershipSummary(req.user!.id);
    res.json(result);
  } catch (err) {
    handleRouteError(res, 'Get membership summary error', err);
  }
});

// ── GET /:id — グループ詳細 ──────────────────────────────────

router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const groupId = parseGroupId(req.params.id);
    if (!groupId) {
      respondInvalidId(res);
      return;
    }
    const result = await groupService.getGroupDetail(groupId, req.user!.id);
    res.json(result);
  } catch (err) {
    handleRouteError(res, 'Get group detail error', err);
  }
});

// ── PUT /:id — グループ更新 ──────────────────────────────────

router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const groupId = parseGroupId(req.params.id);
    if (!groupId) {
      respondInvalidId(res);
      return;
    }
    const parsed = UpdateGroupBody.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      res.status(400).json({ error: issue?.message ?? 'リクエスト形式が不正です' });
      return;
    }
    const result = await groupService.updateGroup(groupId, req.user!.id, parsed.data);
    res.json(result);
  } catch (err) {
    handleRouteError(res, 'Update group error', err);
  }
});

// ── DELETE /:id — グループ削除 ──────────────────────────────────

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const groupId = parseGroupId(req.params.id);
    if (!groupId) {
      respondInvalidId(res);
      return;
    }
    await groupService.deleteGroup(groupId, req.user!.id);
    res.status(204).send();
  } catch (err) {
    handleRouteError(res, 'Delete group error', err);
  }
});

// ── POST /:id/invite — メンバー招待 ──────────────────────────────────

router.post('/:id/invite', async (req: AuthRequest, res: Response) => {
  try {
    const groupId = parseGroupId(req.params.id);
    if (!groupId) {
      respondInvalidId(res);
      return;
    }
    const parsed = InviteBody.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      res.status(400).json({ error: issue?.message ?? 'リクエスト形式が不正です' });
      return;
    }
    await groupService.inviteMember(groupId, req.user!.id, parsed.data.pharmacyId);
    res.status(201).json({ message: '招待を送信しました' });
  } catch (err) {
    handleRouteError(res, 'Invite member error', err);
  }
});

// ── POST /:id/join — グループ参加 ──────────────────────────────────

router.post('/:id/join', async (req: AuthRequest, res: Response) => {
  try {
    const groupId = parseGroupId(req.params.id);
    if (!groupId) {
      respondInvalidId(res);
      return;
    }
    await groupService.joinPublicGroup(groupId, req.user!.id);
    res.json({ message: 'グループに参加しました' });
  } catch (err) {
    handleRouteError(res, 'Join group error', err);
  }
});

// ── POST /:id/accept — 招待承認 ──────────────────────────────────

router.post('/:id/accept', async (req: AuthRequest, res: Response) => {
  try {
    const groupId = parseGroupId(req.params.id);
    if (!groupId) {
      respondInvalidId(res);
      return;
    }
    await groupService.acceptInvitation(groupId, req.user!.id);
    res.json({ message: '招待を承認しました' });
  } catch (err) {
    handleRouteError(res, 'Accept invitation error', err);
  }
});

router.post('/:id/decline', async (req: AuthRequest, res: Response) => {
  try {
    const groupId = parseGroupId(req.params.id);
    if (!groupId) {
      respondInvalidId(res);
      return;
    }
    await groupService.declineInvitation(groupId, req.user!.id);
    res.json({ message: '招待を辞退しました' });
  } catch (err) {
    handleRouteError(res, 'Decline invitation error', err);
  }
});

// ── POST /:id/leave — グループ脱退 ──────────────────────────────────

router.post('/:id/leave', async (req: AuthRequest, res: Response) => {
  try {
    const groupId = parseGroupId(req.params.id);
    if (!groupId) {
      respondInvalidId(res);
      return;
    }
    await groupService.leaveGroup(groupId, req.user!.id);
    res.json({ message: 'グループを脱退しました' });
  } catch (err) {
    handleRouteError(res, 'Leave group error', err);
  }
});

// ── DELETE /:id/members/:pharmacyId — メンバー削除 ──────────────────────────────────

router.delete('/:id/members/:pharmacyId', async (req: AuthRequest, res: Response) => {
  try {
    const groupId = parseGroupId(req.params.id);
    const targetPharmacyId = parseGroupId(req.params.pharmacyId);
    if (!groupId || !targetPharmacyId) {
      respondInvalidId(res);
      return;
    }
    await groupService.removeMember(groupId, req.user!.id, targetPharmacyId);
    res.status(204).send();
  } catch (err) {
    handleRouteError(res, 'Remove member error', err);
  }
});

export default router;
