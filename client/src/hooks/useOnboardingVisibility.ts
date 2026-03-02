import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UploadStatus } from '../components/dashboard/types';
import { useAuth } from '../contexts/AuthContext';
import { ONBOARDING_STEPS, readScopedFlag, writeScopedFlag } from '../components/onboarding/onboardingSteps';

const STORAGE_KEY = 'dss.onboarding.dismissed';

export function useOnboardingVisibility(status: UploadStatus | null): {
  shouldShow: boolean;
  dismiss: () => void;
} {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const allComplete = useMemo(
    () => ONBOARDING_STEPS.every((step) => step.isComplete(status, userId)),
    [status, userId],
  );

  const [dismissed, setDismissed] = useState(() => readScopedFlag(STORAGE_KEY, userId, STORAGE_KEY));

  useEffect(() => {
    setDismissed((prev) => {
      const next = readScopedFlag(STORAGE_KEY, userId, STORAGE_KEY);
      return prev === next ? prev : next;
    });
  }, [userId]);

  const shouldShow = !dismissed && !allComplete;

  const dismiss = useCallback(() => {
    writeScopedFlag(STORAGE_KEY, userId);
    setDismissed(true);
  }, [userId]);

  return { shouldShow, dismiss };
}
