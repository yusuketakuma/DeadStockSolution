import { beforeEach, vi } from 'vitest';

export function setupVitestMocks(mode: 'clear' | 'reset' = 'clear'): void {
  beforeEach(() => {
    if (mode === 'reset') {
      vi.resetAllMocks();
      return;
    }

    vi.clearAllMocks();
  });
}
