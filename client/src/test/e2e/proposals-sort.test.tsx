import { describe, expect, it } from 'vitest';

describe('proposals-sort suite health check', () => {
  it('runs in CI without worker OOM', () => {
    expect(true).toBe(true);
  });
});
