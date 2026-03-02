import { describe, it, expect } from 'vitest';
import { ONBOARDING_STEPS, markMatchingDone, readOnboardingMatchingDone } from './onboardingSteps';
import type { UploadStatus } from '../dashboard/types';

function makeStatus(overrides: Partial<UploadStatus> = {}): UploadStatus {
  return {
    deadStockUploaded: false,
    usedMedicationUploaded: false,
    lastDeadStockUpload: null,
    lastUsedMedicationUpload: null,
    ...overrides,
  };
}

describe('onboardingSteps', () => {
  it('should have 3 steps', () => {
    expect(ONBOARDING_STEPS).toHaveLength(3);
  });

  describe('dead-stock-upload step', () => {
    const step = ONBOARDING_STEPS[0];

    it('should be incomplete when not uploaded', () => {
      expect(step.isComplete(makeStatus())).toBe(false);
    });

    it('should be complete when uploaded', () => {
      expect(step.isComplete(makeStatus({ deadStockUploaded: true }))).toBe(true);
    });

    it('should be incomplete when status is null', () => {
      expect(step.isComplete(null)).toBe(false);
    });
  });

  describe('used-medication-upload step', () => {
    const step = ONBOARDING_STEPS[1];

    it('should be incomplete when not uploaded', () => {
      expect(step.isComplete(makeStatus())).toBe(false);
    });

    it('should be complete when uploaded', () => {
      expect(step.isComplete(makeStatus({ usedMedicationUploaded: true }))).toBe(true);
    });
  });

  describe('matching step', () => {
    const step = ONBOARDING_STEPS[2];

    it('should be incomplete by default', () => {
      expect(step.isComplete(makeStatus(), 10)).toBe(false);
    });

    it('should be complete when localStorage flag is set', () => {
      markMatchingDone(10);
      expect(step.isComplete(makeStatus(), 10)).toBe(true);
      expect(readOnboardingMatchingDone(10)).toBe(true);
    });

    it('should not inherit legacy global flag for authenticated users', () => {
      localStorage.setItem('dss.onboarding.matchingDone', 'true');
      expect(step.isComplete(makeStatus(), 99)).toBe(false);
      expect(readOnboardingMatchingDone(99)).toBe(false);
    });
  });
});
