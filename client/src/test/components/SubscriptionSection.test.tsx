import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SubscriptionSection from '../../components/account/SubscriptionSection';
import { renderWithProviders } from '../helpers';

const mockListSubscriptionPlans = vi.fn();
const mockGetSubscriptionOverview = vi.fn();
const mockCreateSubscriptionCheckoutSession = vi.fn();
const mockCancelCurrentSubscription = vi.fn();

vi.mock('../../api/subscriptions', () => ({
  listSubscriptionPlans: (...args: unknown[]) => mockListSubscriptionPlans(...args),
  getSubscriptionOverview: (...args: unknown[]) => mockGetSubscriptionOverview(...args),
  createSubscriptionCheckoutSession: (...args: unknown[]) => mockCreateSubscriptionCheckoutSession(...args),
  cancelCurrentSubscription: (...args: unknown[]) => mockCancelCurrentSubscription(...args),
  getSubscriptionPlanName: (planType: string) => ({
    light: 'ライトプラン',
    standard: 'スタンダードプラン',
    enterprise: 'エンタープライズプラン',
  }[planType] ?? planType),
}));

describe('SubscriptionSection', () => {
  beforeEach(() => {
    mockListSubscriptionPlans.mockResolvedValue({
      plans: [],
      stripeConfigured: true,
    });
    mockGetSubscriptionOverview.mockResolvedValue({
      subscriptions: [
        {
          id: 1,
          planType: 'standard',
          status: 'active',
          currentPeriodStart: '2026-06-01T00:00:00.000Z',
          currentPeriodEnd: '2026-07-01T00:00:00.000Z',
          cancelAtPeriodEnd: false,
          canceledAt: null,
          createdAt: '2026-06-01T00:00:00.000Z',
        },
      ],
      activeSubscription: {
        id: 1,
        planType: 'standard',
        status: 'active',
        currentPeriodStart: '2026-06-01T00:00:00.000Z',
        currentPeriodEnd: '2026-07-01T00:00:00.000Z',
        cancelAtPeriodEnd: false,
        canceledAt: null,
        createdAt: '2026-06-01T00:00:00.000Z',
      },
    });
    mockCreateSubscriptionCheckoutSession.mockResolvedValue({ sessionId: 'sess_test', url: 'https://example.test/checkout' });
    mockCancelCurrentSubscription.mockResolvedValue({
      success: true,
      message: '解約しました',
      canceledAt: '2026-06-02T00:00:00.000Z',
      cancelAtPeriodEnd: false,
    });
  });

  it('hides immediate cancellation behind the cancellation action menu', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SubscriptionSection enabled />);

    await waitFor(() => {
      expect(screen.getByText('利用中')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: '期間終了で解約する' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '即時解約する' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '解約操作' }));
    await user.click(screen.getByRole('button', { name: '即時解約する' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('即時解約の確認');
  });
});
