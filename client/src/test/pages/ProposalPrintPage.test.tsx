import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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
      expect(screen.getByRole('link', { name: '提案詳細へ' })).toHaveAttribute('href', '/proposals/9');
    });

    expect(screen.getByRole('link', { name: 'マッチング一覧' })).toHaveAttribute('href', '/proposals');
    expect(screen.getByRole('link', { name: '交換履歴' })).toHaveAttribute('href', '/exchange-history');
  });
});
