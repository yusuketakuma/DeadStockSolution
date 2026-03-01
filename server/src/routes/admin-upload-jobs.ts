import { Router, Response } from 'express';
import { AuthRequest } from '../types';
import {
  getErrorMessage,
  parseIdOrBadRequest,
  parseListPagination,
  sendPaginated,
} from './admin-utils';
import {
  cancelAdminUploadJob,
  getAdminUploadJobDetail,
  getAdminUploadJobErrorReport,
  isUploadConfirmRetryUnavailableError,
  listAdminUploadJobs,
  retryAdminUploadJob,
  type AdminUploadJobListFilters,
  type UploadJobStatus,
} from '../services/admin-upload-job-service';
import { logger } from '../services/logger';
import { type ApplyMode, type UploadType } from '../services/upload-confirm-service';

const router = Router();

const VALID_UPLOAD_JOB_STATUSES: UploadJobStatus[] = ['pending', 'processing', 'completed', 'failed', 'canceled'];
const VALID_UPLOAD_TYPES: UploadType[] = ['dead_stock', 'used_medication'];
const VALID_APPLY_MODES: ApplyMode[] = ['replace', 'diff', 'partial'];

function parseOptionalPositiveInt(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  if (!/^\d+$/.test(value.trim())) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function parseUploadJobFilters(req: AuthRequest): AdminUploadJobListFilters {
  const { page, limit } = parseListPagination(req, 50);

  const statusRaw = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  const uploadTypeRaw = typeof req.query.uploadType === 'string' ? req.query.uploadType.trim() : '';
  const applyModeRaw = typeof req.query.applyMode === 'string' ? req.query.applyMode.trim() : '';
  const keywordRaw = typeof req.query.keyword === 'string' ? req.query.keyword.trim() : '';
  const normalizedStatusRaw = statusRaw === 'cancelled' ? 'canceled' : statusRaw;

  const filters: AdminUploadJobListFilters = {
    page,
    limit,
  };

  if (VALID_UPLOAD_JOB_STATUSES.includes(normalizedStatusRaw as UploadJobStatus)) {
    filters.status = normalizedStatusRaw as UploadJobStatus;
  }

  if (VALID_UPLOAD_TYPES.includes(uploadTypeRaw as UploadType)) {
    filters.uploadType = uploadTypeRaw as UploadType;
  }

  if (VALID_APPLY_MODES.includes(applyModeRaw as ApplyMode)) {
    filters.applyMode = applyModeRaw as ApplyMode;
  }

  const pharmacyId = parseOptionalPositiveInt(req.query.pharmacyId);
  if (pharmacyId) {
    filters.pharmacyId = pharmacyId;
  }
  if (keywordRaw.length > 0) {
    filters.keyword = keywordRaw.slice(0, 100);
  }

  return filters;
}

router.get('/upload-jobs', async (req: AuthRequest, res: Response) => {
  try {
    const filters = parseUploadJobFilters(req);
    const { data, total } = await listAdminUploadJobs(filters);
    sendPaginated(res, data, filters.page, filters.limit, total, {
      filters: {
        status: filters.status ?? null,
        uploadType: filters.uploadType ?? null,
        applyMode: filters.applyMode ?? null,
        pharmacyId: filters.pharmacyId ?? null,
        keyword: filters.keyword ?? null,
      },
    });
  } catch (err) {
    logger.error('Admin upload jobs list error', { error: getErrorMessage(err) });
    res.status(500).json({ error: 'アップロードジョブ一覧の取得に失敗しました' });
  }
});

router.get('/upload-jobs/:id', async (req: AuthRequest, res: Response) => {
  try {
    const jobId = parseIdOrBadRequest(res, req.params.id);
    if (!jobId) return;

    const detail = await getAdminUploadJobDetail(jobId);
    if (!detail) {
      res.status(404).json({ error: 'ジョブが見つかりません' });
      return;
    }

    res.json(detail);
  } catch (err) {
    logger.error('Admin upload job detail error', { error: getErrorMessage(err) });
    res.status(500).json({ error: 'アップロードジョブ詳細の取得に失敗しました' });
  }
});

router.patch('/upload-jobs/:id/cancel', async (req: AuthRequest, res: Response) => {
  try {
    const jobId = parseIdOrBadRequest(res, req.params.id);
    if (!jobId) return;

    const result = await cancelAdminUploadJob(jobId, req.user!.id);
    if (!result) {
      res.status(404).json({ error: 'ジョブが見つかりません' });
      return;
    }

    if (!result.canceledAt && !result.cancelRequestedAt) {
      res.status(409).json({
        error: result.cancelable
          ? 'キャンセル要求の反映で競合しました。再度お試しください'
          : 'このジョブはキャンセルできません',
      });
      return;
    }

    res.json({
      message: result.canceledAt
        ? 'ジョブをキャンセルしました'
        : 'ジョブのキャンセルを受け付けました',
      job: result,
    });
  } catch (err) {
    logger.error('Admin upload job cancel error', { error: getErrorMessage(err) });
    res.status(500).json({ error: 'アップロードジョブのキャンセルに失敗しました' });
  }
});

router.post('/upload-jobs/:id/retry', async (req: AuthRequest, res: Response) => {
  try {
    const jobId = parseIdOrBadRequest(res, req.params.id);
    if (!jobId) return;

    const retried = await retryAdminUploadJob(jobId);
    if (!retried) {
      res.status(404).json({ error: 'ジョブが見つかりません' });
      return;
    }

    res.json({
      message: 'ジョブを再試行キューへ戻しました',
      job: retried,
    });
  } catch (err) {
    if (isUploadConfirmRetryUnavailableError(err)) {
      res.status(409).json({ error: err.message, code: err.code });
      return;
    }

    logger.error('Admin upload job retry error', { error: getErrorMessage(err) });
    res.status(500).json({ error: 'アップロードジョブの再試行に失敗しました' });
  }
});

router.get('/upload-jobs/:id/error-report', async (req: AuthRequest, res: Response) => {
  try {
    const jobId = parseIdOrBadRequest(res, req.params.id);
    if (!jobId) return;

    const format = req.query.format === 'json' ? 'json' : 'csv';
    const report = await getAdminUploadJobErrorReport(jobId, format);
    if (!report) {
      res.status(404).json({ error: 'エラーレポートがありません' });
      return;
    }

    res.setHeader('Content-Type', report.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`);
    res.status(200).send(report.body);
  } catch (err) {
    logger.error('Admin upload job error report error', { error: getErrorMessage(err) });
    res.status(500).json({ error: 'エラーレポートの生成に失敗しました' });
  }
});

export default router;
