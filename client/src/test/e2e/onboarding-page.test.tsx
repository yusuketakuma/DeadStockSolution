import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../helpers';
import OnboardingPage from '../../pages/OnboardingPage';

describe('OnboardingPage', () => {
  it('fires onboarding info request on mount', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<OnboardingPage />, { route: '/onboarding' });

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes('/auth/onboarding-info')),
    ).toBe(true);
  });
});
