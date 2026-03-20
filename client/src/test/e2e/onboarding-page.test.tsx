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

    // The useEffect calls api.get('/auth/onboarding-info') which uses fetch internally.
    // The onboarding page does not wire up an AbortController in its useEffect,
    // so we verify the request is made on mount.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/auth/onboarding-info');
  });
});
