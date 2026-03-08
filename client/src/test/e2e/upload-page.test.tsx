import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UploadPage from '../../pages/UploadPage';
import { mockUser, renderWithProviders } from '../helpers';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createPreviewResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    headers: ['コード', '薬剤名', '数量', '単位', '期限'],
    rows: [['111', '薬A', '10', '錠', '2026-03-31']],
    suggestedMapping: {
      drug_code: '0',
      drug_name: '1',
      quantity: '2',
      unit: '3',
      yakka_unit_price: null,
      expiration_date: '4',
      lot_number: null,
    },
    suggestedMappingByType: {
      dead_stock: {
        drug_code: '0',
        drug_name: '1',
        quantity: '2',
        unit: '3',
        yakka_unit_price: null,
        expiration_date: '4',
        lot_number: null,
      },
      used_medication: {
        drug_code: '0',
        drug_name: '1',
        monthly_usage: '2',
        unit: '3',
        yakka_unit_price: null,
      },
    },
    headerRowIndex: 0,
    hasSavedMapping: false,
    detectedUploadType: 'dead_stock',
    resolvedUploadType: 'dead_stock',
    rememberedUploadType: null,
    uploadTypeConfidence: 'high',
    uploadTypeScores: {
      dead_stock: 28,
      used_medication: 9,
    },
    ...overrides,
  };
}

describe('UploadPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows excel and camera flows side-by-side while keeping excel validation visible', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
      }
      if (url.includes('/api/upload/preview')) {
        return jsonResponse({ error: 'プレビュー失敗テスト' }, 500);
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<UploadPage />);
    await waitFor(() => {
      expect(screen.getByText('Excelアップロード')).toBeInTheDocument();
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    if (!fileInput) {
      throw new Error('file input not found');
    }
    const file = new File(['dummy-xlsx-content'], 'dead-stock.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await userEvent.upload(fileInput, file);
    await userEvent.click(screen.getByRole('button', { name: 'プレビュー' }));

    await waitFor(() => {
      expect(screen.getByText('プレビュー失敗テスト')).toBeInTheDocument();
    });

    expect(screen.getByText('カメラ取込み')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'カメラ取込へ移動' })).toBeInTheDocument();
    expect(screen.getByText('プレビュー失敗テスト')).toBeInTheDocument();
  });

  it('auto-detects upload type and allows manual correction', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
      }
      if (url.includes('/api/upload/preview')) {
        return jsonResponse(createPreviewResponse());
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<UploadPage />);
    await waitFor(() => {
      expect(screen.getByText('Excelアップロード')).toBeInTheDocument();
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    if (!fileInput) {
      throw new Error('file input not found');
    }

    const file = new File(['dummy-xlsx-content'], 'dead-stock.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await userEvent.upload(fileInput, file);
    await userEvent.click(screen.getByRole('button', { name: 'プレビュー' }));

    await waitFor(() => {
      expect(screen.getByText('取込内容の確認')).toBeInTheDocument();
    });

    const uploadTypeSelect = screen.getByLabelText('取込種別') as HTMLSelectElement;
    expect(uploadTypeSelect.value).toBe('dead_stock');

    await userEvent.selectOptions(uploadTypeSelect, 'used_medication');

    expect(screen.getByText('自動判定結果を手動修正しています。この種別で取り込みます。')).toBeInTheDocument();
  });

  it('submits confirm via async job endpoint and waits for completion', async () => {
    let jobStatusCallCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
      }
      if (url.includes('/api/upload/preview')) {
        return jsonResponse(createPreviewResponse());
      }
      if (url.includes('/api/upload/confirm-async')) {
        return jsonResponse({
          message: 'アップロード処理を受け付けました',
          jobId: 77,
          status: 'pending',
        }, 202);
      }
      if (url.includes('/api/upload/jobs/77')) {
        jobStatusCallCount += 1;
        if (jobStatusCallCount === 1) {
          return jsonResponse({
            id: 77,
            status: 'pending',
            attempts: 0,
            lastError: null,
            result: null,
          });
        }
        return jsonResponse({
          id: 77,
          status: 'completed',
          attempts: 1,
          lastError: null,
          result: {
            uploadId: 501,
            rowCount: 2,
            applyMode: 'replace',
          },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<UploadPage />);
    await waitFor(() => {
      expect(screen.getByText('Excelアップロード')).toBeInTheDocument();
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    if (!fileInput) {
      throw new Error('file input not found');
    }
    const file = new File(['dummy-xlsx-content'], 'dead-stock.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await userEvent.upload(fileInput, file);
    await userEvent.click(screen.getByRole('button', { name: 'プレビュー' }));

    await waitFor(() => {
      expect(screen.getByText('取込内容の確認')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'この設定でデータを登録' }));

    await waitFor(() => {
      expect(screen.getByText(/2件のデータを登録しました/)).toBeInTheDocument();
    });

    expect(jobStatusCallCount).toBeGreaterThan(0);
    const calledUrls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(calledUrls.some((url) => url.includes('/api/upload/confirm-async'))).toBe(true);
    expect(calledUrls.some((url) => url.includes('/api/upload/jobs/77'))).toBe(true);
  });

  it('handles sync fallback response from confirm-async without polling', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
      }
      if (url.includes('/api/upload/preview')) {
        return jsonResponse(createPreviewResponse());
      }
      if (url.includes('/api/upload/confirm-async')) {
        return jsonResponse({
          message: 'キュー登録に失敗したため同期処理で適用しました',
          jobId: null,
          status: 'completed_sync_fallback',
          rowCount: 2,
          uploadId: 600,
          partialSummary: null,
          errorReportAvailable: false,
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<UploadPage />);
    await waitFor(() => {
      expect(screen.getByText('Excelアップロード')).toBeInTheDocument();
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    if (!fileInput) {
      throw new Error('file input not found');
    }
    const file = new File(['dummy-xlsx-content'], 'dead-stock.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await userEvent.upload(fileInput, file);
    await userEvent.click(screen.getByRole('button', { name: 'プレビュー' }));

    await waitFor(() => {
      expect(screen.getByText('取込内容の確認')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'この設定でデータを登録' }));

    await waitFor(() => {
      expect(screen.getByText('キュー登録に失敗したため同期処理で適用しました')).toBeInTheDocument();
    });

    const calledUrls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(calledUrls.some((url) => url.includes('/api/upload/confirm-async'))).toBe(true);
    expect(calledUrls.some((url) => url.includes('/api/upload/jobs/'))).toBe(false);
  });

  it('retries polling when a transient job status error occurs', async () => {
    let jobStatusCallCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
      }
      if (url.includes('/api/upload/preview')) {
        return jsonResponse(createPreviewResponse());
      }
      if (url.includes('/api/upload/confirm-async')) {
        return jsonResponse({
          message: 'アップロード処理を受け付けました',
          jobId: 89,
          status: 'pending',
        }, 202);
      }
      if (url.includes('/api/upload/jobs/89')) {
        jobStatusCallCount += 1;
        if (jobStatusCallCount === 1) {
          return jsonResponse({ error: 'temporary upstream error' }, 502);
        }
        return jsonResponse({
          id: 89,
          status: 'completed',
          attempts: 1,
          lastError: null,
          result: {
            uploadId: 503,
            rowCount: 1,
            applyMode: 'replace',
          },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<UploadPage />);
    await waitFor(() => {
      expect(screen.getByText('Excelアップロード')).toBeInTheDocument();
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    if (!fileInput) {
      throw new Error('file input not found');
    }
    const file = new File(['dummy-xlsx-content'], 'dead-stock.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await userEvent.upload(fileInput, file);
    await userEvent.click(screen.getByRole('button', { name: 'プレビュー' }));

    await waitFor(() => {
      expect(screen.getByText('取込内容の確認')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'この設定でデータを登録' }));

    await waitFor(() => {
      expect(screen.getByText(/1件のデータを登録しました/)).toBeInTheDocument();
    });
    expect(jobStatusCallCount).toBeGreaterThanOrEqual(2);
  });

  it('keeps job id message when polling keeps failing after retry limit', async () => {
    let jobStatusCallCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
      }
      if (url.includes('/api/upload/preview')) {
        return jsonResponse(createPreviewResponse());
      }
      if (url.includes('/api/upload/confirm-async')) {
        return jsonResponse({
          message: 'アップロード処理を受け付けました',
          jobId: 96,
          status: 'pending',
        }, 202);
      }
      if (url.includes('/api/upload/jobs/96')) {
        jobStatusCallCount += 1;
        return jsonResponse({ error: 'temporary upstream error' }, 502);
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<UploadPage />);
    await waitFor(() => {
      expect(screen.getByText('Excelアップロード')).toBeInTheDocument();
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    if (!fileInput) throw new Error('file input not found');
    const file = new File(['dummy-xlsx-content'], 'dead-stock.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await userEvent.upload(fileInput, file);
    await userEvent.click(screen.getByRole('button', { name: 'プレビュー' }));

    await waitFor(() => {
      expect(screen.getByText('取込内容の確認')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'この設定でデータを登録' }));

    await waitFor(() => {
      expect(screen.getByText('temporary upstream error')).toBeInTheDocument();
    });
    expect(screen.getByText(/ジョブは継続中の可能性があります（ジョブID: 96）/)).toBeInTheDocument();
    expect(jobStatusCallCount).toBeGreaterThanOrEqual(2);
  });

  it('shows failed async job error and clears queue message', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
      }
      if (url.includes('/api/upload/preview')) {
        return jsonResponse(createPreviewResponse());
      }
      if (url.includes('/api/upload/confirm-async')) {
        return jsonResponse({
          message: 'アップロード処理を受け付けました',
          jobId: 88,
          status: 'pending',
        }, 202);
      }
      if (url.includes('/api/upload/jobs/88')) {
        return jsonResponse({
          id: 88,
          status: 'failed',
          attempts: 1,
          lastError: 'アップロード処理に失敗しました。時間をおいて再実行してください。',
          lastErrorCode: 'UPLOAD_CONFIRM_FAILED',
          result: null,
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<UploadPage />);
    await waitFor(() => {
      expect(screen.getByText('Excelアップロード')).toBeInTheDocument();
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    if (!fileInput) {
      throw new Error('file input not found');
    }
    const file = new File(['dummy-xlsx-content'], 'dead-stock.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await userEvent.upload(fileInput, file);
    await userEvent.click(screen.getByRole('button', { name: 'プレビュー' }));

    await waitFor(() => {
      expect(screen.getByText('取込内容の確認')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'この設定でデータを登録' }));

    await waitFor(() => {
      expect(screen.getByText('アップロード処理に失敗しました。時間をおいて再実行してください。')).toBeInTheDocument();
    });
    expect(screen.queryByText(/アップロード処理を受け付けました/)).not.toBeInTheDocument();
  });

  it('handles deduplicated/partial summary/error report fields from job status', async () => {
    let jobStatusCallCount = 0;
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
      }
      if (url.includes('/api/upload/preview')) {
        return jsonResponse(createPreviewResponse());
      }
      if (url.includes('/api/upload/confirm-async')) {
        return jsonResponse({
          message: 'アップロード処理を受け付けました',
          jobId: 121,
          status: 'pending',
          deduplicated: true,
        }, 202);
      }
      if (url.includes('/api/upload/jobs/121')) {
        jobStatusCallCount += 1;
        if (jobStatusCallCount === 1) {
          return jsonResponse({
            id: 121,
            status: 'pending',
            attempts: 0,
            cancelable: true,
            deduplicated: true,
            errorReportAvailable: true,
            partialSummary: {
              processed: 5,
              failed: 1,
            },
            lastError: null,
            result: null,
          });
        }
        return jsonResponse({
          id: 121,
          status: 'completed',
          attempts: 1,
          deduplicated: true,
          errorReportAvailable: true,
          lastError: null,
          result: {
            uploadId: 550,
            rowCount: 2,
            applyMode: 'replace',
            partialSummary: {
              processed: 6,
              failed: 1,
            },
            deduplicated: true,
            errorReportAvailable: true,
          },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<UploadPage />);
    await waitFor(() => {
      expect(screen.getByText('Excelアップロード')).toBeInTheDocument();
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    if (!fileInput) throw new Error('file input not found');
    const file = new File(['dummy-xlsx-content'], 'dead-stock.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await userEvent.upload(fileInput, file);
    await userEvent.click(screen.getByRole('button', { name: 'プレビュー' }));

    await waitFor(() => {
      expect(screen.getByText('取込内容の確認')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'この設定でデータを登録' }));

    await waitFor(() => {
      expect(screen.getByText(/同一内容の重複送信はジョブに集約されました/)).toBeInTheDocument();
    });
    expect(screen.getByText(/部分サマリー:/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'エラーレポートをダウンロード' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: 'エラーレポートをダウンロード' }));
    expect(openSpy).toHaveBeenCalledWith('/api/upload/jobs/121/error-report', '_blank', 'noopener');
  });

  it('requires acknowledgement when diff deleteMissing deactivates existing records', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
      }
      if (url.includes('/api/upload/preview')) {
        return jsonResponse(createPreviewResponse());
      }
      if (url.includes('/api/upload/diff-preview')) {
        return jsonResponse({
          summary: {
            inserted: 1,
            updated: 2,
            deactivated: 3,
            unchanged: 4,
            totalIncoming: 10,
          },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<UploadPage />);
    await waitFor(() => {
      expect(screen.getByText('Excelアップロード')).toBeInTheDocument();
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    if (!fileInput) throw new Error('file input not found');

    const file = new File(['dummy-xlsx-content'], 'dead-stock.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await userEvent.upload(fileInput, file);
    await userEvent.click(screen.getByRole('button', { name: 'プレビュー' }));

    await waitFor(() => {
      expect(screen.getByText('取込内容の確認')).toBeInTheDocument();
    });

    await userEvent.selectOptions(screen.getByLabelText('反映方式'), 'diff');
    await userEvent.click(screen.getByLabelText('差分に存在しない既存データを無効化/削除する'));
    await userEvent.click(screen.getByRole('button', { name: '差分プレビューを更新' }));

    await waitFor(() => {
      expect(screen.getByText(/無効化・削除: 3件/)).toBeInTheDocument();
    });

    const submitButton = screen.getByRole('button', { name: 'この設定でデータを登録' });
    expect(submitButton).toBeDisabled();

    await userEvent.click(screen.getByLabelText('無効化・削除 3 件の影響を確認しました'));
    expect(submitButton).toBeEnabled();
  });

  it('invalidates diff preview when upload type is changed after preview', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
      }
      if (url.includes('/api/upload/preview')) {
        return jsonResponse(createPreviewResponse());
      }
      if (url.includes('/api/upload/diff-preview')) {
        return jsonResponse({
          summary: {
            inserted: 1,
            updated: 0,
            deactivated: 2,
            unchanged: 0,
            totalIncoming: 3,
          },
        });
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<UploadPage />);
    await waitFor(() => {
      expect(screen.getByText('Excelアップロード')).toBeInTheDocument();
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    if (!fileInput) throw new Error('file input not found');

    const file = new File(['dummy-xlsx-content'], 'dead-stock.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await userEvent.upload(fileInput, file);
    await userEvent.click(screen.getByRole('button', { name: 'プレビュー' }));

    await waitFor(() => {
      expect(screen.getByText('取込内容の確認')).toBeInTheDocument();
    });

    await userEvent.selectOptions(screen.getByLabelText('反映方式'), 'diff');
    await userEvent.click(screen.getByLabelText('差分に存在しない既存データを無効化/削除する'));
    await userEvent.click(screen.getByRole('button', { name: '差分プレビューを更新' }));

    await waitFor(() => {
      expect(screen.getByText(/無効化・削除: 2件/)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByLabelText('無効化・削除 2 件の影響を確認しました'));
    expect(screen.getByRole('button', { name: 'この設定でデータを登録' })).toBeEnabled();

    await userEvent.selectOptions(screen.getByLabelText('取込種別'), 'used_medication');

    expect(screen.getByRole('button', { name: 'この設定でデータを登録' })).toBeDisabled();
    expect(screen.getByText('無効化・削除を有効にした場合は、送信前に「差分プレビューを更新」を実行してください。')).toBeInTheDocument();
    expect(screen.queryByText(/無効化・削除: 2件/)).not.toBeInTheDocument();
  });
});
