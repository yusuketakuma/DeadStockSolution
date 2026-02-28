import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UploadPage from '../../pages/UploadPage';
import { mockUser, renderWithProviders, setupFetchMock } from '../helpers';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('UploadPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows used-medication required fields aligned with backend schema', async () => {
    setupFetchMock({
      '/api/auth/me': mockUser,
    });

    renderWithProviders(<UploadPage />);

    await waitFor(() => {
      expect(screen.getByText('Excelアップロード')).toBeInTheDocument();
    });
    expect(screen.getByText('YJコード / GS1コード、薬剤名、数量、包装単位、期限')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('アップロードタイプ'), 'used_medication');

    expect(screen.getByText('薬剤名、月間使用量')).toBeInTheDocument();
    expect(screen.queryByText('YJコード / GS1コード、薬剤名、数量、包装単位、期限、月間使用量')).not.toBeInTheDocument();
  });

  it('submits confirm via async job endpoint and waits for completion', async () => {
    let jobStatusCallCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
      }
      if (url.includes('/api/upload/preview')) {
        return jsonResponse({
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
          headerRowIndex: 0,
          hasSavedMapping: false,
        });
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
      expect(screen.getByText('フィールド割り当て')).toBeInTheDocument();
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

  it('retries polling when a transient job status error occurs', async () => {
    let jobStatusCallCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
      }
      if (url.includes('/api/upload/preview')) {
        return jsonResponse({
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
          headerRowIndex: 0,
          hasSavedMapping: false,
        });
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
      expect(screen.getByText('フィールド割り当て')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'この設定でデータを登録' }));

    await waitFor(() => {
      expect(screen.getByText(/1件のデータを登録しました/)).toBeInTheDocument();
    });
    expect(jobStatusCallCount).toBeGreaterThanOrEqual(2);
  });

  it('shows failed async job error and clears success queue message', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
      }
      if (url.includes('/api/upload/preview')) {
        return jsonResponse({
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
          headerRowIndex: 0,
          hasSavedMapping: false,
        });
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
      expect(screen.getByText('フィールド割り当て')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'この設定でデータを登録' }));

    await waitFor(() => {
      expect(screen.getByText('アップロード処理に失敗しました。時間をおいて再実行してください。')).toBeInTheDocument();
    });
    expect(screen.queryByText(/アップロード処理を受け付けました/)).not.toBeInTheDocument();
    expect(screen.queryByText(/非同期処理中です/)).not.toBeInTheDocument();
  });
});

it('requires acknowledgement when diff deleteMissing deactivates existing records', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/auth/me')) {
      return jsonResponse(mockUser);
    }
    if (url.includes('/api/upload/preview')) {
      return jsonResponse({
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
        headerRowIndex: 0,
        hasSavedMapping: false,
      });
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
    if (url.includes('/api/upload/confirm-async')) {
      return jsonResponse({
        message: 'アップロード処理を受け付けました',
        jobId: 90,
        status: 'pending',
      }, 202);
    }
    if (url.includes('/api/upload/jobs/90')) {
      return jsonResponse({
        id: 90,
        status: 'completed',
        attempts: 1,
        lastError: null,
        result: {
          uploadId: 504,
          rowCount: 10,
          applyMode: 'diff',
          diffSummary: {
            inserted: 1,
            updated: 2,
            deactivated: 3,
            unchanged: 4,
            totalIncoming: 10,
          },
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
    expect(screen.getByText('フィールド割り当て')).toBeInTheDocument();
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

it('invalidates diff preview when mapping is changed after preview', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/auth/me')) {
      return jsonResponse(mockUser);
    }
    if (url.includes('/api/upload/preview')) {
      return jsonResponse({
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
        headerRowIndex: 0,
        hasSavedMapping: false,
      });
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
    expect(screen.getByText('フィールド割り当て')).toBeInTheDocument();
  });

  await userEvent.selectOptions(screen.getByLabelText('反映方式'), 'diff');
  await userEvent.click(screen.getByLabelText('差分に存在しない既存データを無効化/削除する'));
  await userEvent.click(screen.getByRole('button', { name: '差分プレビューを更新' }));

  await waitFor(() => {
    expect(screen.getByText(/無効化・削除: 2件/)).toBeInTheDocument();
  });

  await userEvent.click(screen.getByLabelText('無効化・削除 2 件の影響を確認しました'));
  expect(screen.getByRole('button', { name: 'この設定でデータを登録' })).toBeEnabled();

  await userEvent.selectOptions(screen.getByLabelText('薬剤名 の割り当て'), '0');

  expect(screen.getByRole('button', { name: 'この設定でデータを登録' })).toBeDisabled();
  expect(screen.getByText('無効化・削除を有効にした場合は、送信前に「差分プレビューを更新」を実行してください。')).toBeInTheDocument();
  expect(screen.queryByText(/無効化・削除: 2件/)).not.toBeInTheDocument();
});
