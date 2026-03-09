import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execFileAsync: vi.fn(),
  getMonitoringKpiSnapshot: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('util', () => ({
  promisify: () => mocks.execFileAsync,
}));

vi.mock('../services/monitoring-kpi-service', () => ({
  getMonitoringKpiSnapshot: mocks.getMonitoringKpiSnapshot,
}));

vi.mock('../services/logger', () => ({
  logger: mocks.logger,
}));

import { runMonitoringKpiAlertCheck } from '../services/monitoring-kpi-alert-scheduler';

describe('monitoring-kpi-alert-scheduler', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      MONITORING_KPI_ALERT_ENABLED: 'true',
      MONITORING_KPI_ALERT_TARGET: 'ops-room',
      MONITORING_KPI_ALERT_CHANNEL: 'telegram',
      PATH: '/usr/bin',
      HOME: '/tmp/home',
      USER: 'tester',
      LANG: 'ja_JP.UTF-8',
    };

    mocks.getMonitoringKpiSnapshot.mockResolvedValue({
      status: 'warning',
      breaches: { errorRate5xx: true, uploadFailureRate: false, pendingStaleCount: false },
      metrics: { errorRate5xx: 12.5, uploadFailureRate: 0, pendingUploadStaleCount: 0 },
      thresholds: { errorRate5xx: 5, uploadFailureRate: 10, pendingStaleCount: 5 },
      context: { windowMinutes: 60 },
    });
    mocks.execFileAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('passes a minimal environment to the alert CLI process', async () => {
    const result = await runMonitoringKpiAlertCheck();

    expect(result.status).toBe('alerted');
    expect(mocks.execFileAsync).toHaveBeenCalledWith(
      'openclaw',
      expect.any(Array),
      expect.objectContaining({
        env: {
          PATH: '/usr/bin',
          HOME: '/tmp/home',
          USER: 'tester',
          LANG: 'ja_JP.UTF-8',
        },
      }),
    );
  });
});
