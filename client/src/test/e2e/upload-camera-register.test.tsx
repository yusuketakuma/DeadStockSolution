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

describe('UploadPage camera register mode', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves scanned code and confirms batch register', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
      }
      if (url.includes('/api/inventory/dead-stock/camera/resolve')) {
        return jsonResponse({
          codeType: 'gs1',
          parsed: {
            gtin: '04912345678904',
            yjCode: null,
            expirationDate: '2026-06-30',
            lotNumber: 'LOT999',
          },
          match: {
            drugMasterId: 10,
            drugMasterPackageId: 50,
            drugName: 'テスト薬',
            yjCode: '2171014F1020',
            gs1Code: '04912345678904',
            janCode: '4912345678904',
            packageLabel: '100錠',
            unit: '錠',
            yakkaUnitPrice: 12.3,
          },
          warnings: [],
        });
      }
      if (url.includes('/api/inventory/dead-stock/camera/confirm-batch')) {
        return jsonResponse({
          message: '1件のデータを登録しました',
          uploadId: 321,
          createdCount: 1,
        }, 201);
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });

    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<UploadPage />);

    await waitFor(() => {
      expect(screen.getByText('Excelアップロード')).toBeInTheDocument();
    });

    await userEvent.selectOptions(screen.getByLabelText('登録モード'), 'camera');

    const codeInput = await screen.findByPlaceholderText('例: (01)...(17)...(10)... または YJコード');
    await userEvent.type(codeInput, '01049123456789041726063010LOT999');
    await userEvent.click(screen.getByRole('button', { name: '解析して追加' }));

    await waitFor(() => {
      expect(screen.getByText('テスト薬')).toBeInTheDocument();
    });

    const quantityInput = screen.getByRole('spinbutton');
    await userEvent.type(quantityInput, '5');

    await userEvent.click(screen.getByRole('button', { name: '一括登録' }));

    await waitFor(() => {
      expect(screen.getByText(/1件のデータを登録しました/)).toBeInTheDocument();
    });

    const confirmCall = fetchMock.mock.calls.find((call) => {
      const url = typeof call[0] === 'string' ? call[0] : call[0].toString();
      return url.includes('/api/inventory/dead-stock/camera/confirm-batch');
    });
    expect(confirmCall).toBeTruthy();

    const requestBody = confirmCall?.[1]?.body;
    expect(typeof requestBody).toBe('string');
    const payload = JSON.parse(String(requestBody));
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toEqual(expect.objectContaining({
      drugMasterId: 10,
      drugMasterPackageId: 50,
      quantity: 5,
      expirationDate: '2026-06-30',
      lotNumber: 'LOT999',
    }));
    expect(payload.items[0]).not.toHaveProperty('drugName');
    expect(payload.items[0]).not.toHaveProperty('unit');
    expect(payload.items[0]).not.toHaveProperty('yakkaUnitPrice');
  });

  it('allows unmatched rows to be resolved by manual drug search', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
      }
      if (url.includes('/api/inventory/dead-stock/camera/resolve')) {
        return jsonResponse({
          codeType: 'unknown',
          parsed: {
            gtin: null,
            yjCode: null,
            expirationDate: null,
            lotNumber: null,
          },
          match: null,
          warnings: ['GS1またはYJコードとして認識できませんでした。'],
        });
      }
      if (url.includes('/api/inventory/dead-stock/camera/manual-candidates')) {
        return jsonResponse({
          data: [
            {
              drugMasterId: 99,
              drugMasterPackageId: 199,
              drugName: '手動確定薬',
              yjCode: '9999999F9999',
              gs1Code: null,
              janCode: null,
              packageLabel: 'PTP 100錠',
              unit: '錠',
              yakkaUnitPrice: 20,
            },
          ],
        });
      }
      if (url.includes('/api/inventory/dead-stock/camera/confirm-batch')) {
        return jsonResponse({
          message: '1件のデータを登録しました',
          uploadId: 654,
          createdCount: 1,
        }, 201);
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });

    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<UploadPage />);

    await waitFor(() => {
      expect(screen.getByText('Excelアップロード')).toBeInTheDocument();
    });

    await userEvent.selectOptions(screen.getByLabelText('登録モード'), 'camera');

    const codeInput = await screen.findByPlaceholderText('例: (01)...(17)...(10)... または YJコード');
    await userEvent.type(codeInput, 'UNKNOWN-CODE');
    await userEvent.click(screen.getByRole('button', { name: '解析して追加' }));

    await waitFor(() => {
      expect(screen.getByText('未一致')).toBeInTheDocument();
    });

    const searchInput = await screen.findByPlaceholderText('薬剤名 or YJコードで検索');
    await userEvent.type(searchInput, '手動');
    await userEvent.click(screen.getByRole('button', { name: '候補検索' }));

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /手動確定薬/ })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: '確定' }));

    const quantityInput = screen.getByRole('spinbutton');
    await userEvent.type(quantityInput, '3');
    await userEvent.click(screen.getByRole('button', { name: '一括登録' }));

    await waitFor(() => {
      expect(screen.getByText(/1件のデータを登録しました/)).toBeInTheDocument();
    });

    const confirmCall = fetchMock.mock.calls.find((call) => {
      const url = typeof call[0] === 'string' ? call[0] : call[0].toString();
      return url.includes('/api/inventory/dead-stock/camera/confirm-batch');
    });
    expect(confirmCall).toBeTruthy();

    const payload = JSON.parse(String(confirmCall?.[1]?.body));
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toEqual(expect.objectContaining({
      drugMasterId: 99,
      drugMasterPackageId: 199,
      packageLabel: 'PTP 100錠',
      quantity: 3,
    }));
  });
});
