import { eq, inArray } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacies, type AdminAuditAction } from '../db/schema';
import { invalidateAuthUserCache } from '../middleware/auth';
import type {
  BulkActionResult,
  BulkActionPreviewItem,
  BulkPharmacyActionRequest,
  BulkPharmacyActionResponse,
} from '../types/admin';
import { logger } from './logger';
import { recordAuditLog } from './audit-log-service';

export type BulkPharmacyActionKind = 'verify' | 'reject' | 'activate' | 'deactivate';

type TargetPharmacy = {
  id: number;
  verificationStatus: string | null;
  isActive: boolean | null;
};

type BulkPharmacyActionConfig = {
  action: BulkPharmacyActionKind;
  requireReason: boolean;
  successMessage: string;
  applyUpdate: (target: TargetPharmacy, now: string, reason: string | undefined) => {
    skip: boolean;
    values?: {
      verificationStatus?: string;
      isActive?: boolean;
      verifiedAt?: string | null;
      rejectionReason?: string | null;
      updatedAt: string;
    };
    previousStatus: string | null;
    newStatus: string;
  };
};

const BULK_ACTION_CONFIG: Record<BulkPharmacyActionKind, BulkPharmacyActionConfig> = {
  verify: {
    action: 'verify',
    requireReason: false,
    successMessage: '一括承認を実行しました',
    applyUpdate: (target, now) => ({
      skip: target.verificationStatus === 'verified',
      values: {
        verificationStatus: 'verified',
        isActive: true,
        verifiedAt: now,
        rejectionReason: null,
        updatedAt: now,
      },
      previousStatus: target.verificationStatus,
      newStatus: 'verified',
    }),
  },
  reject: {
    action: 'reject',
    requireReason: true,
    successMessage: '一括却下を実行しました',
    applyUpdate: (target, now, reason) => ({
      skip: target.verificationStatus === 'rejected',
      values: {
        verificationStatus: 'rejected',
        isActive: false,
        verifiedAt: null,
        rejectionReason: reason ?? null,
        updatedAt: now,
      },
      previousStatus: target.verificationStatus,
      newStatus: 'rejected',
    }),
  },
  activate: {
    action: 'activate',
    requireReason: false,
    successMessage: '一括有効化を実行しました',
    applyUpdate: (target, now) => ({
      skip: target.isActive === true,
      values: {
        isActive: true,
        updatedAt: now,
      },
      previousStatus: target.isActive === true ? 'active' : 'inactive',
      newStatus: 'active',
    }),
  },
  deactivate: {
    action: 'deactivate',
    requireReason: false,
    successMessage: '一括無効化を実行しました',
    applyUpdate: (target, now) => ({
      skip: target.isActive === false,
      values: {
        isActive: false,
        updatedAt: now,
      },
      previousStatus: target.isActive === true ? 'active' : 'inactive',
      newStatus: 'inactive',
    }),
  },
};

export function parseBulkPharmacyActionRequest(
  body: unknown,
  fixedAction?: BulkPharmacyActionKind,
): { ok: true; data: BulkPharmacyActionRequest & { action: BulkPharmacyActionKind } } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'リクエスト形式が不正です' };
  }

  const { pharmacyIds, reason, action } = body as Record<string, unknown>;
  if (!Array.isArray(pharmacyIds) || pharmacyIds.length === 0) {
    return { ok: false, error: '対象薬局IDを1つ以上指定してください' };
  }
  if (pharmacyIds.length > 100) {
    return { ok: false, error: '一括操作は最大100件までです' };
  }
  if (!pharmacyIds.every((id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0)) {
    return { ok: false, error: '薬局IDは正の整数で指定してください' };
  }

  const resolvedAction = fixedAction ?? action;
  if (!isBulkPharmacyActionKind(resolvedAction)) {
    return { ok: false, error: 'action は verify / reject / activate / deactivate のいずれかで指定してください' };
  }

  const normalizedReason = typeof reason === 'string' && reason.trim().length > 0 ? reason.trim() : undefined;
  if (BULK_ACTION_CONFIG[resolvedAction].requireReason && !normalizedReason) {
    return { ok: false, error: '却下理由は必須です' };
  }

  return {
    ok: true,
    data: {
      pharmacyIds: [...new Set(pharmacyIds)],
      reason: normalizedReason,
      action: resolvedAction,
    },
  };
}

export async function executeBulkPharmacyAction(input: {
  adminId: number;
  pharmacyIds: number[];
  reason?: string;
  action: BulkPharmacyActionKind;
}): Promise<BulkPharmacyActionResponse> {
  const config = BULK_ACTION_CONFIG[input.action];

  const auditEntries = await db.transaction(async (tx) => {
    const targetPharmacies = await tx.select({
      id: pharmacies.id,
      verificationStatus: pharmacies.verificationStatus,
      isActive: pharmacies.isActive,
    })
      .from(pharmacies)
      .where(inArray(pharmacies.id, input.pharmacyIds));

    const targetMap = new Map(targetPharmacies.map((pharmacy) => [pharmacy.id, pharmacy]));
    const results: BulkActionResult[] = [];
    const auditLogs: Array<{
      pharmacyId: number;
      action: AdminAuditAction;
      previousStatus: string | null;
      newStatus: string;
    }> = [];

    for (const pharmacyId of input.pharmacyIds) {
      const target = targetMap.get(pharmacyId);
      if (!target) {
        throw new Error(`薬局ID:${pharmacyId} が見つかりません`);
      }

      const now = new Date().toISOString();
      const updatePlan = config.applyUpdate(target, now, input.reason);
      if (!updatePlan.skip && updatePlan.values) {
        await tx.update(pharmacies)
          .set(updatePlan.values)
          .where(eq(pharmacies.id, pharmacyId));
      }

      results.push({ pharmacyId, success: true });
      auditLogs.push({
        pharmacyId,
        action: config.action,
        previousStatus: updatePlan.previousStatus,
        newStatus: updatePlan.newStatus,
      });
    }

    return { results, auditLogs };
  });

  for (const result of auditEntries.results) {
    invalidateAuthUserCache(result.pharmacyId);
  }

  await Promise.all(auditEntries.auditLogs.map(async (entry) => {
    try {
      await recordAuditLog({
        adminId: input.adminId,
        targetPharmacyId: entry.pharmacyId,
        action: entry.action,
        previousStatus: entry.previousStatus,
        newStatus: entry.newStatus,
        reason: input.reason ?? null,
      });
    } catch (err) {
      logger.error('Failed to record bulk pharmacy audit log', {
        pharmacyId: entry.pharmacyId,
        action: entry.action,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }));

  return {
    message: `${config.successMessage}（${auditEntries.results.length}件）`,
    totalRequested: input.pharmacyIds.length,
    succeeded: auditEntries.results.filter((result) => result.success).length,
    failed: auditEntries.results.filter((result) => !result.success).length,
    results: auditEntries.results,
  };
}

export async function previewBulkAction(
  pharmacyIds: number[],
  action: BulkPharmacyActionKind,
): Promise<BulkActionPreviewItem[]> {
  const targets = await db
    .select({
      id: pharmacies.id,
      name: pharmacies.name,
      verificationStatus: pharmacies.verificationStatus,
      isActive: pharmacies.isActive,
    })
    .from(pharmacies)
    .where(inArray(pharmacies.id, pharmacyIds));

  const now = new Date().toISOString();
  return targets.map((target) => {
    const result = BULK_ACTION_CONFIG[action].applyUpdate(target, now, undefined);
    return {
      pharmacyId: target.id,
      pharmacyName: target.name,
      currentStatus: target.verificationStatus,
      newStatus: result.skip ? target.verificationStatus : result.newStatus,
      wouldSkip: result.skip ?? false,
      skipReason: result.skip ? '既に対象の状態です' : undefined,
    };
  });
}

function isBulkPharmacyActionKind(value: unknown): value is BulkPharmacyActionKind {
  return value === 'verify' || value === 'reject' || value === 'activate' || value === 'deactivate';
}
