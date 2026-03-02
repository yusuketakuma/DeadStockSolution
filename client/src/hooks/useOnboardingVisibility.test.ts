import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOnboardingVisibility } from './useOnboardingVisibility';
import type { UploadStatus } from '../components/dashboard/types';

let mockUserId: number | null = 1;

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mockUserId == null ? null : { id: mockUserId },
  }),
}));

function makeStatus(overrides: Partial<UploadStatus> = {}): UploadStatus {
  return {
    deadStockUploaded: false,
    usedMedicationUploaded: false,
    lastDeadStockUpload: null,
    lastUsedMedicationUpload: null,
    ...overrides,
  };
}

describe('useOnboardingVisibility', () => {
  beforeEach(() => {
    localStorage.clear();
    mockUserId = 1;
  });

  it('should show when steps are incomplete and not dismissed', () => {
    const { result } = renderHook(() => useOnboardingVisibility(makeStatus()));
    expect(result.current.shouldShow).toBe(true);
  });

  it('should not show when dismissed', () => {
    localStorage.setItem('dss.onboarding.dismissed:1', 'true');
    const { result } = renderHook(() => useOnboardingVisibility(makeStatus()));
    expect(result.current.shouldShow).toBe(false);
  });

  it('should not show when all steps are complete', () => {
    localStorage.setItem('dss.onboarding.matchingDone:1', 'true');
    const status = makeStatus({ deadStockUploaded: true, usedMedicationUploaded: true });
    const { result } = renderHook(() => useOnboardingVisibility(status));
    expect(result.current.shouldShow).toBe(false);
  });

  it('should set dismissed flag on dismiss', () => {
    const { result } = renderHook(() => useOnboardingVisibility(makeStatus()));
    act(() => result.current.dismiss());
    expect(localStorage.getItem('dss.onboarding.dismissed:1')).toBe('true');
  });

  it('should show when status is null and not dismissed', () => {
    const { result } = renderHook(() => useOnboardingVisibility(null));
    expect(result.current.shouldShow).toBe(true);
  });

  it('should isolate dismissed state by user id', () => {
    localStorage.setItem('dss.onboarding.dismissed:1', 'true');
    const { result, rerender } = renderHook(() => useOnboardingVisibility(makeStatus()));
    expect(result.current.shouldShow).toBe(false);

    mockUserId = 2;
    rerender();
    expect(result.current.shouldShow).toBe(true);
  });

  it('should not inherit legacy global dismissed flag for authenticated users', () => {
    localStorage.setItem('dss.onboarding.dismissed', 'true');
    const { result } = renderHook(() => useOnboardingVisibility(makeStatus()));
    expect(result.current.shouldShow).toBe(true);
    expect(localStorage.getItem('dss.onboarding.dismissed:1')).not.toBe('true');
  });
});
