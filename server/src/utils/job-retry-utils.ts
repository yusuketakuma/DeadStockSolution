export function getStaleBeforeIso(staleTimeoutMs: number): string {
  return new Date(Date.now() - staleTimeoutMs).toISOString();
}

export function getNextRetryIso(
  nextAttempts: number,
  maxAttempts: number,
  backoffBaseMs: number,
): string | null {
  if (nextAttempts >= maxAttempts) return null;
  const backoffMs = backoffBaseMs * Math.max(1, nextAttempts);
  return new Date(Date.now() + backoffMs).toISOString();
}
