import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SubscriptionSuccessPage from '../../pages/SubscriptionSuccessPage';
import { renderWithProviders } from '../helpers';

describe('SubscriptionSuccessPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('polls until the active subscription is reflected', async () => {
    let subscriptionCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/subscriptions')) {
        subscriptionCalls += 1;
        if (subscriptionCalls === 1) {
          return new Response(JSON.stringify({ subscriptions: [], activeSubscription: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({
          subscriptions: [
            {
              id: 1,
              planType: 'standard',
              status: 'active',
              currentPeriodStart: '2026-03-28T00:00:00.000Z',
              currentPeriodEnd: '2026-04-28T00:00:00.000Z',
              cancelAtPeriodEnd: false,
              canceledAt: null,
              createdAt: '2026-03-28T00:00:00.000Z',
            },
          ],
          activeSubscription: {
            id: 1,
            planType: 'standard',
            status: 'active',
            currentPeriodStart: '2026-03-28T00:00:00.000Z',
            currentPeriodEnd: '2026-04-28T00:00:00.000Z',
            cancelAtPeriodEnd: false,
            canceledAt: null,
            createdAt: '2026-03-28T00:00:00.000Z',
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<SubscriptionSuccessPage />, {
      route: '/subscription/success?session_id=cs_test_123',
    });

    expect(screen.getByText('決済が完了しました')).toBeInTheDocument();
    expect(screen.getByText(/契約反映を確認中/)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
      await Promise.resolve();
    });

    expect(screen.getByText(/スタンダードプラン の反映を確認しました/)).toBeInTheDocument();
  });
});
