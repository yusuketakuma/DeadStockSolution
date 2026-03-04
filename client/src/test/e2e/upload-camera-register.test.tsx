import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserMultiFormatReader } from '@zxing/browser';
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

  it('shows auto candidates from scanned code and requires manual confirmation', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
      }
      if (url.includes('/api/inventory/dead-stock/camera/resolve')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { rawCode?: string };
        expect(body.rawCode).toBe('04912345678904');
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
      if (url.includes('/api/inventory/dead-stock/camera/manual-candidates')) {
        return jsonResponse({ data: [] });
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

    const codeInput = await screen.findByPlaceholderText('例: (01)...(17)...(10)... または YJコード');
    await userEvent.type(codeInput, '04912345678904');
    await userEvent.click(screen.getByRole('button', { name: '解析して追加' }));

    await waitFor(() => {
      expect(screen.getByText('候補確認待ち')).toBeInTheDocument();
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
      drugMasterId: 10,
      drugMasterPackageId: 50,
      packageLabel: '100錠',
      quantity: 3,
    }));
  });

  it('can confirm unmatched row with manual candidate search', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
      }
      if (url.includes('/api/inventory/dead-stock/camera/resolve')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { rawCode?: string };
        expect(body.rawCode).toBe('UNKNOWN-CODE');
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

    const codeInput = await screen.findByPlaceholderText('例: (01)...(17)...(10)... または YJコード');
    await userEvent.type(codeInput, 'UNKNOWN-CODE');
    await userEvent.click(screen.getByRole('button', { name: '解析して追加' }));

    await waitFor(() => {
      expect(screen.getByText('候補確認待ち')).toBeInTheDocument();
    });

    const searchInput = await screen.findByPlaceholderText('薬剤名 or YJコードで検索');
    await userEvent.clear(searchInput);
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

  it('captures multiple codes from a camera frame and registers them together', async () => {
    const originalIsSecureContext = Object.getOwnPropertyDescriptor(window, 'isSecureContext');
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true,
    });

    const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }),
      },
    });

    class MockBarcodeDetector {
      detect = vi.fn().mockResolvedValue([
        { rawValue: '04912345678904' },
        { rawValue: '04912345678911' },
      ]);
    }
    const originalBarcodeDetector = (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
    (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = MockBarcodeDetector;

    const decodeFromConstraintsSpy = vi
      .spyOn(BrowserMultiFormatReader.prototype, 'decodeFromConstraints')
      .mockImplementation(async () => ({
        stop: vi.fn(),
      } as unknown as Awaited<ReturnType<BrowserMultiFormatReader['decodeFromConstraints']>>));
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({
        drawImage: vi.fn(),
      } as unknown as CanvasRenderingContext2D);

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
      }
      if (url.includes('/api/inventory/dead-stock/camera/resolve')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { rawCode?: string };
        const mapping: Record<string, { id: number; code: string; label: string }> = {
          '04912345678904': { id: 10, code: '2171014F1020', label: '100錠' },
          '04912345678911': { id: 11, code: '1171014F2020', label: '50錠' },
        };
        const matched = mapping[body.rawCode ?? ''];
        return jsonResponse({
          codeType: 'gs1',
          parsed: {
            gtin: body.rawCode ?? null,
            yjCode: null,
            expirationDate: null,
            lotNumber: null,
          },
          match: matched
            ? {
              drugMasterId: matched.id,
              drugMasterPackageId: matched.id + 100,
              drugName: `テスト薬${matched.id}`,
              yjCode: matched.code,
              gs1Code: body.rawCode ?? null,
              janCode: null,
              packageLabel: matched.label,
              unit: '錠',
              yakkaUnitPrice: 10,
            }
            : null,
          warnings: [],
        });
      }
      if (url.includes('/api/inventory/dead-stock/camera/manual-candidates')) {
        return jsonResponse({ data: [] });
      }
      if (url.includes('/api/inventory/dead-stock/camera/confirm-batch')) {
        return jsonResponse({
          message: '2件のデータを登録しました',
          uploadId: 777,
          createdCount: 2,
        }, 201);
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      renderWithProviders(<UploadPage />);
      await waitFor(() => {
        expect(screen.getByText('Excelアップロード')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: 'カメラ開始' }));
      const video = document.querySelector('video') as HTMLVideoElement | null;
      expect(video).not.toBeNull();
      if (!video) {
        throw new Error('video element not found');
      }
      Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1280 });
      Object.defineProperty(video, 'videoHeight', { configurable: true, value: 720 });

      await userEvent.click(screen.getByRole('button', { name: '画像からコード検出' }));

      await waitFor(() => {
        expect(screen.getByText(/画像内コードを 2 件追加しました/)).toBeInTheDocument();
      });

      const confirmButtons = screen.getAllByRole('button', { name: '確定' });
      expect(confirmButtons).toHaveLength(2);
      await userEvent.click(confirmButtons[0]);
      await userEvent.click(confirmButtons[1]);

      const quantityInputs = screen.getAllByRole('spinbutton');
      expect(quantityInputs.length).toBeGreaterThanOrEqual(2);
      await userEvent.type(quantityInputs[0], '1');
      await userEvent.type(quantityInputs[1], '2');
      await userEvent.click(screen.getByRole('button', { name: '一括登録' }));

      await waitFor(() => {
        expect(screen.getByText(/2件のデータを登録しました/)).toBeInTheDocument();
      });

      const confirmCall = fetchMock.mock.calls.find((call) => {
        const url = typeof call[0] === 'string' ? call[0] : call[0].toString();
        return url.includes('/api/inventory/dead-stock/camera/confirm-batch');
      });
      expect(confirmCall).toBeTruthy();
      const payload = JSON.parse(String(confirmCall?.[1]?.body));
      expect(payload.items).toHaveLength(2);
    } finally {
      decodeFromConstraintsSpy.mockRestore();
      getContextSpy.mockRestore();
      if (originalBarcodeDetector === undefined) {
        delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
      } else {
        (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = originalBarcodeDetector;
      }
      if (originalIsSecureContext) {
        Object.defineProperty(window, 'isSecureContext', originalIsSecureContext);
      }
      if (originalMediaDevices) {
        Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
      }
    }
  });

  it('shows camera error on insecure context', async () => {
    const originalIsSecureContext = Object.getOwnPropertyDescriptor(window, 'isSecureContext');
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: false,
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/me')) {
        return jsonResponse(mockUser);
      }
      return jsonResponse({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      renderWithProviders(<UploadPage />);
      await waitFor(() => {
        expect(screen.getByText('Excelアップロード')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: 'カメラ開始' }));

      expect(await screen.findByText('カメラ利用にはHTTPS接続が必要です')).toBeInTheDocument();
    } finally {
      if (originalIsSecureContext) {
        Object.defineProperty(window, 'isSecureContext', originalIsSecureContext);
      }
    }
  });
});
