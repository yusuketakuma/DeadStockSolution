import { beforeEach, describe, expect, it } from 'vitest';
import {
  getObservabilitySnapshot,
  recordRequestMetric,
  resetObservabilityMetrics,
} from '../services/observability-service';

describe('observability-service', () => {
  beforeEach(() => {
    resetObservabilityMetrics();
  });

  it('aggregates request metrics', () => {
    const now = Date.now();

    recordRequestMetric({
      timestamp: now - 1_000,
      method: 'GET',
      path: '/api/inventory/browse',
      status: 200,
      durationMs: 80,
    });
    recordRequestMetric({
      timestamp: now - 900,
      method: 'GET',
      path: '/api/inventory/browse',
      status: 500,
      durationMs: 300,
    });
    recordRequestMetric({
      timestamp: now - 800,
      method: 'POST',
      path: '/api/auth/login',
      status: 401,
      durationMs: 40,
    });
    recordRequestMetric({
      timestamp: now - 700,
      method: 'POST',
      path: '/api/admin/messages',
      status: 403,
      durationMs: 25,
    });

    const snapshot = getObservabilitySnapshot(60);

    expect(snapshot.totalRequests).toBe(4);
    expect(snapshot.totalErrors5xx).toBe(1);
    expect(snapshot.errorRate5xx).toBe(25);
    expect(snapshot.authFailures401).toBe(1);
    expect(snapshot.forbidden403).toBe(1);
    expect(snapshot.avgLatencyMs).toBeGreaterThan(0);
    expect(snapshot.p95LatencyMs).toBeGreaterThan(0);
    expect(snapshot.topSlowPaths[0]?.path).toBe('GET /api/inventory/browse');
  });

  it('returns zeros when no metrics exist', () => {
    const snapshot = getObservabilitySnapshot(60);
    expect(snapshot.totalRequests).toBe(0);
    expect(snapshot.totalErrors5xx).toBe(0);
    expect(snapshot.errorRate5xx).toBe(0);
    expect(snapshot.topSlowPaths).toHaveLength(0);
  });

  it('retains only recent metrics within buffer limit', () => {
    const now = Date.now();

    recordRequestMetric({
      timestamp: now - 1_000,
      method: 'GET',
      path: '/api/first',
      status: 500,
      durationMs: 10,
    });

    for (let i = 0; i < 20_000; i += 1) {
      recordRequestMetric({
        timestamp: now,
        method: 'GET',
        path: '/api/next',
        status: 200,
        durationMs: 5,
      });
    }

    const snapshot = getObservabilitySnapshot(60);
    expect(snapshot.totalRequests).toBe(20_000);
    expect(snapshot.totalErrors5xx).toBe(0);
  });
});
