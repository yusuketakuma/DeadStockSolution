import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import ProposalPrintPage from '../../pages/ProposalPrintPage';
import { renderWithProviders } from '../helpers';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ProposalPrintPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps detail and history exits visible when print data fails to load', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/exchange/proposals/9/print')) {
        return jsonResponse({ error: 'broken' }, 500);
      }
      return jsonResponse({});
    }));

    renderWithProviders(
      <Routes>
        <Route path="/proposals/:id/print" element={<ProposalPrintPage />} />
      </Routes>,
      { route: '/proposals/9/print' },
    );

    await waitFor(() => {
      expect(screen.getByRole('link', { name: '提案を確認' })).toHaveAttribute('href', '/proposals/9');
    });

    await userEvent.click(screen.getByRole('button', { name: '関連' }));
    expect(screen.getByRole('link', { name: '提案一覧を確認' })).toHaveAttribute('href', '/proposals');
    expect(screen.getByRole('link', { name: '交換履歴を確認' })).toHaveAttribute('href', '/exchange-history');
  });

  it('prints counter-offer quantities with package context', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/exchange/proposals/12/print')) {
        return jsonResponse({
          proposal: {
            id: 12,
            pharmacyAId: 1,
            pharmacyBId: 2,
            totalValueA: 10000,
            totalValueB: 10000,
            proposedAt: '2026-04-01T00:00:00.000Z',
          },
          pharmacyA: {
            name: 'A薬局',
            phone: '03-1111-1111',
            fax: '03-1111-1112',
            address: '東京都',
            prefecture: '東京都',
            licenseNumber: 'A-1',
          },
          pharmacyB: {
            name: 'B薬局',
            phone: '03-2222-2222',
            fax: '03-2222-2223',
            address: '神奈川県',
            prefecture: '神奈川県',
            licenseNumber: 'B-1',
          },
          items: [{
            id: 501,
            fromPharmacyId: 1,
            toPharmacyId: 2,
            drugName: 'テスト薬A',
            quantity: 200,
            unit: '錠',
            packageLabel: 'PTP 100錠',
            packageQuantity: 100,
            packageUnit: '錠',
            yakkaValue: 10000,
            yakkaUnitPrice: 50,
          }],
          counterOffers: [{
            id: 9,
            status: 'pending',
            summary: '数量を調整します',
            createdAt: '2026-04-02T00:00:00.000Z',
            respondedAt: null,
            items: [{ proposalItemId: 501, drugName: 'テスト薬A', quantity: 100 }],
          }],
        });
      }
      return jsonResponse({});
    }));

    renderWithProviders(
      <Routes>
        <Route path="/proposals/:id/print" element={<ProposalPrintPage />} />
      </Routes>,
      { route: '/proposals/12/print' },
    );

    await waitFor(() => {
      expect(screen.getByText('正式な反対提案')).toBeInTheDocument();
    });

    expect(screen.getByText(/テスト薬A: 総数量 100錠/)).toBeInTheDocument();
    expect(screen.getAllByText(/箱数 1箱/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1箱入数 100錠/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/包装 PTP 100錠/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/テスト薬A x100/)).not.toBeInTheDocument();
  });
});
