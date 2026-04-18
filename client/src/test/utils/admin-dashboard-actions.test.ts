import { describe, expect, it } from 'vitest';
import { deriveAdminPriorityActions } from '../../utils/admin-dashboard-actions';

describe('deriveAdminPriorityActions', () => {
  it('prioritizes degraded OpenClaw and upload issues first', () => {
    const actions = deriveAdminPriorityActions({
      alertsSummary: {
        failedUploadJobs24h: 3,
        stalledUploadJobs24h: 1,
        unreadNotifications: 5,
        pendingProposalActions24h: 2,
      },
      monitoringKpis: {
        status: 'warning',
        breaches: {
          errorRate5xx: true,
          uploadFailureRate: false,
          pendingStaleCount: true,
        },
      },
      openClawHealth: {
        status: 'degraded',
        retryQueue: {
          pending: 4,
          failed: 2,
        },
        ddsAgent: {
          connected: false,
          queuedJobs: 3,
          awaitingUser: 1,
        },
      },
      sloBreaches: { total: 2 },
      cronStatus: [],
    });

    expect(actions[0]?.id).toBe('openclaw');
    expect(actions[1]?.id).toBe('upload-jobs');
    expect(actions.some((action) => action.id === 'monitoring')).toBe(true);
    expect(actions).toHaveLength(4);
  });

  it('returns lower-severity actions when critical issues are absent', () => {
    const actions = deriveAdminPriorityActions({
      alertsSummary: {
        failedUploadJobs24h: 0,
        stalledUploadJobs24h: 0,
        unreadNotifications: 2,
        pendingProposalActions24h: 0,
      },
      monitoringKpis: {
        status: 'healthy',
        breaches: {
          errorRate5xx: false,
          uploadFailureRate: false,
          pendingStaleCount: false,
        },
      },
      openClawHealth: {
        status: 'ok',
        retryQueue: {
          pending: 0,
          failed: 0,
        },
        ddsAgent: {
          connected: true,
          queuedJobs: 0,
          awaitingUser: 0,
        },
      },
      sloBreaches: { total: 0 },
      cronStatus: [{ label: 'daily statistics', lastActivityAt: null }],
    });

    expect(actions[0]?.id).toBe('cron');
    expect(actions[1]?.id).toBe('notifications');
  });
});
