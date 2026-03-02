import type { UploadStatus } from '../dashboard/types';

export interface OnboardingStep {
  id: 'dead-stock-upload' | 'used-medication-upload' | 'matching';
  title: string;
  description: string;
  actionLabel: string;
  actionPath: string;
  isComplete: (status: UploadStatus | null, userId?: number | null) => boolean;
}

const MATCHING_DONE_KEY = 'dss.onboarding.matchingDone';
const ONBOARDING_ANONYMOUS_SCOPE = 'anonymous';

function buildScopedKey(baseKey: string, userId?: number | null): string {
  const scope = userId == null ? ONBOARDING_ANONYMOUS_SCOPE : String(userId);
  return `${baseKey}:${scope}`;
}

export function readScopedFlag(baseKey: string, userId?: number | null, legacyKey?: string): boolean {
  try {
    const scopedKey = buildScopedKey(baseKey, userId);
    if (localStorage.getItem(scopedKey) === 'true') {
      return true;
    }
    if (legacyKey && userId == null && localStorage.getItem(legacyKey) === 'true') {
      localStorage.setItem(scopedKey, 'true');
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function writeScopedFlag(baseKey: string, userId?: number | null): void {
  try {
    localStorage.setItem(buildScopedKey(baseKey, userId), 'true');
  } catch {
    // noop
  }
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'dead-stock-upload',
    title: 'Step 1: デッドストックリストをアップロード',
    description: '交換候補の母集団になるデッドストックデータを登録してください。',
    actionLabel: 'アップロードへ進む',
    actionPath: '/upload',
    isComplete: (s) => s?.deadStockUploaded ?? false,
  },
  {
    id: 'used-medication-upload',
    title: 'Step 2: 医薬品使用量リストをアップロード',
    description: '当月の医薬品使用量データをアップロードすると、マッチング機能が利用できます。',
    actionLabel: 'アップロードへ進む',
    actionPath: '/upload',
    isComplete: (s) => s?.usedMedicationUploaded ?? false,
  },
  {
    id: 'matching',
    title: 'Step 3: マッチングを実行',
    description: '他薬局のデッドストックから、あなたの薬局で使用できる医薬品を検索します。',
    actionLabel: 'マッチングへ進む',
    actionPath: '/matching',
    isComplete: (_status, userId) => readScopedFlag(MATCHING_DONE_KEY, userId),
  },
];

export function markMatchingDone(userId?: number | null): void {
  writeScopedFlag(MATCHING_DONE_KEY, userId);
}

export function readOnboardingMatchingDone(userId?: number | null): boolean {
  return readScopedFlag(MATCHING_DONE_KEY, userId);
}

export function buildOnboardingScopedKey(baseKey: string, userId?: number | null): string {
  return buildScopedKey(baseKey, userId);
}
