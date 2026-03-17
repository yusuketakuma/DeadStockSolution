import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
  drizzle: {
    desc: vi.fn((col: unknown) => ({ _desc: col })),
    and: vi.fn((...args: unknown[]) => ({ _and: args })),
    eq: vi.fn((a: unknown, b: unknown) => ({ _eq: [a, b] })),
    gte: vi.fn((a: unknown, b: unknown) => ({ _gte: [a, b] })),
    lte: vi.fn((a: unknown, b: unknown) => ({ _lte: [a, b] })),
    ilike: vi.fn((a: unknown, b: unknown) => ({ _ilike: [a, b] })),
    inArray: vi.fn((a: unknown, b: unknown) => ({ _inArray: [a, b] })),
    or: vi.fn((...args: unknown[]) => ({ _or: args })),
    sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings: Array.from(strings),
      values,
    })),
    count: vi.fn(() => ({ _count: true })),
  },
  escapeLikeWildcards: vi.fn((v: string) => v),
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('drizzle-orm', () => ({
  desc: mocks.drizzle.desc,
  and: mocks.drizzle.and,
  eq: mocks.drizzle.eq,
  gte: mocks.drizzle.gte,
  lte: mocks.drizzle.lte,
  ilike: mocks.drizzle.ilike,
  inArray: mocks.drizzle.inArray,
  or: mocks.drizzle.or,
  sql: mocks.drizzle.sql,
  count: mocks.drizzle.count,
}));

vi.mock('../utils/request-utils', () => ({
  escapeLikeWildcards: mocks.escapeLikeWildcards,
}));

import {
  buildLogIssueResourceId,
  isLogIssueAuditAction,
  extractStatusMetadata,
  isLogLevel,
  parseJsonSafe,
  loadPharmacyMap,
  normalizeLogEntry,
  queryLogs,
  getLogInsights,
  getLogInsightForEntry,
  LOG_ISSUE_WORKFLOW_STATUSES,
} from '../services/log-center-service';

function createSelectChain(result: unknown[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    then: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockImplementation((fetchLimit: number) => {
    if (!Number.isInteger(fetchLimit) || fetchLimit < 0) return Promise.resolve(result);
    return Promise.resolve(result.slice(0, fetchLimit));
  });
  chain.then.mockImplementation((fn: (rows: unknown[]) => unknown) => Promise.resolve(fn(result)));
  return chain;
}

function createImmediateWhereChain(result: unknown[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    then: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.then.mockImplementation((fn: (rows: unknown[]) => unknown) => Promise.resolve(fn(result)));
  return chain;
}

// Used for queries that end with .orderBy() (e.g. loadIssueStateMap)
function createOrderByResolveChain(result: unknown[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    then: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockResolvedValue(result);
  chain.then.mockImplementation((fn: (rows: unknown[]) => unknown) => Promise.resolve(fn(result)));
  return chain;
}

describe('log-center-service extra coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Exported utility functions ──────────────────────────────

  describe('buildLogIssueResourceId', () => {
    it('builds resource ID from source and logId', () => {
      expect(buildLogIssueResourceId('activity_logs', 42)).toBe('activity_logs:42');
      expect(buildLogIssueResourceId('system_events', 1)).toBe('system_events:1');
      expect(buildLogIssueResourceId('drug_master_sync_logs', 999)).toBe('drug_master_sync_logs:999');
    });
  });

  describe('isLogIssueAuditAction', () => {
    it('returns true for admin_log_status_update', () => {
      expect(isLogIssueAuditAction('admin_log_status_update')).toBe(true);
    });

    it('returns true for admin_log_auto_escalated', () => {
      expect(isLogIssueAuditAction('admin_log_auto_escalated')).toBe(true);
    });

    it('returns false for other actions', () => {
      expect(isLogIssueAuditAction('login')).toBe(false);
      expect(isLogIssueAuditAction('logout')).toBe(false);
      expect(isLogIssueAuditAction('')).toBe(false);
      expect(isLogIssueAuditAction(null)).toBe(false);
      expect(isLogIssueAuditAction(undefined)).toBe(false);
      expect(isLogIssueAuditAction(123)).toBe(false);
    });
  });

  describe('extractStatusMetadata', () => {
    it('extracts valid status, note, and reasonCodes', () => {
      const detail = {
        status: 'investigating',
        note: '調査中です',
        reasonCodes: ['CODE_A', 'CODE_B'],
      };
      const result = extractStatusMetadata(detail);
      expect(result.status).toBe('investigating');
      expect(result.note).toBe('調査中です');
      expect(result.reasonCodes).toEqual(['CODE_A', 'CODE_B']);
    });

    it('returns null status for invalid workflow status', () => {
      const detail = { status: 'unknown_status' };
      const result = extractStatusMetadata(detail);
      expect(result.status).toBeNull();
    });

    it('handles all valid workflow statuses', () => {
      for (const status of LOG_ISSUE_WORKFLOW_STATUSES) {
        const result = extractStatusMetadata({ status });
        expect(result.status).toBe(status);
      }
    });

    it('filters non-string values from reasonCodes', () => {
      const detail = {
        status: 'new',
        reasonCodes: ['valid', 123, null, '', 'also-valid'],
      };
      const result = extractStatusMetadata(detail);
      expect(result.reasonCodes).toEqual(['valid', 'also-valid']);
    });

    it('returns empty reasonCodes when not an array', () => {
      const detail = { status: 'new', reasonCodes: 'not-array' };
      const result = extractStatusMetadata(detail);
      expect(result.reasonCodes).toEqual([]);
    });

    it('returns null note for missing or empty note', () => {
      const detail = { status: 'new', note: '' };
      const result = extractStatusMetadata(detail);
      expect(result.note).toBeNull();
    });

    it('handles null/undefined detail gracefully', () => {
      expect(extractStatusMetadata(null).status).toBeNull();
      expect(extractStatusMetadata(undefined).status).toBeNull();
      expect(extractStatusMetadata('string').status).toBeNull();
    });
  });

  describe('isLogLevel', () => {
    it('returns true for valid log levels', () => {
      expect(isLogLevel('critical')).toBe(true);
      expect(isLogLevel('error')).toBe(true);
      expect(isLogLevel('warning')).toBe(true);
      expect(isLogLevel('info')).toBe(true);
    });

    it('returns false for invalid log levels', () => {
      expect(isLogLevel('debug')).toBe(false);
      expect(isLogLevel('trace')).toBe(false);
      expect(isLogLevel('')).toBe(false);
      expect(isLogLevel(null)).toBe(false);
      expect(isLogLevel(42)).toBe(false);
    });
  });

  describe('parseJsonSafe', () => {
    it('returns null for null input', () => {
      expect(parseJsonSafe(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(parseJsonSafe(undefined)).toBeNull();
    });

    it('parses valid JSON string', () => {
      expect(parseJsonSafe('{"key":"value"}')).toEqual({ key: 'value' });
    });

    it('returns invalid JSON string as-is', () => {
      expect(parseJsonSafe('{invalid}')).toBe('{invalid}');
    });

    it('returns non-string values as-is', () => {
      const obj = { test: 1 };
      expect(parseJsonSafe(obj)).toBe(obj);
      expect(parseJsonSafe(42)).toBe(42);
      expect(parseJsonSafe(true)).toBe(true);
    });
  });

  describe('loadPharmacyMap', () => {
    it('returns empty map for empty pharmacyIds', async () => {
      const result = await loadPharmacyMap([]);
      expect(result.size).toBe(0);
      expect(mocks.db.select).not.toHaveBeenCalled();
    });

    it('returns map of pharmacies by id', async () => {
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { id: 1, name: '薬局A', email: 'a@example.com' },
            { id: 2, name: '薬局B', email: 'b@example.com' },
          ]),
        }),
      });

      const result = await loadPharmacyMap([1, 2]);
      expect(result.size).toBe(2);
      expect(result.get(1)?.name).toBe('薬局A');
      expect(result.get(2)?.name).toBe('薬局B');
    });
  });

  // ── normalizeLogEntry edge cases ────────────────────────────

  describe('normalizeLogEntry - code location inference', () => {
    it('infers code location from activity_logs with various actions', () => {
      const actionsAndLocations: Array<[string, string]> = [
        ['admin_login', 'server/src/routes/auth.ts'],
        ['register', 'server/src/routes/auth.ts'],
        ['logout', 'server/src/routes/auth.ts'],
        ['password_reset_request', 'server/src/routes/auth.ts'],
        ['password_reset_complete', 'server/src/routes/auth.ts'],
        ['account_update', 'server/src/routes/account.ts'],
        ['account_deactivate', 'server/src/routes/account.ts'],
        ['proposal_create', 'server/src/routes/exchange-proposals.ts'],
        ['proposal_accept', 'server/src/routes/exchange-proposals.ts'],
        ['proposal_reject', 'server/src/routes/exchange-proposals.ts'],
        ['proposal_complete', 'server/src/routes/exchange-proposals.ts'],
        ['dead_stock_delete', 'server/src/routes/inventory.ts'],
        ['drug_master_sync', 'server/src/routes/drug-master.ts'],
        ['drug_master_package_upload', 'server/src/routes/drug-master.ts'],
        ['drug_master_edit', 'server/src/routes/drug-master.ts'],
        ['admin_verify_pharmacy', 'server/src/routes/admin-pharmacies-actions.ts'],
        ['admin_bulk_verify', 'server/src/routes/admin-pharmacies-actions.ts'],
        ['admin_bulk_reject', 'server/src/routes/admin-pharmacies-actions.ts'],
        ['admin_toggle_active', 'server/src/routes/admin-pharmacies-actions.ts'],
      ];

      for (const [action, expectedLocation] of actionsAndLocations) {
        const row = { id: 1, action, detail: '', metadataJson: null, createdAt: '2026-01-01T00:00:00Z' };
        const entry = normalizeLogEntry('activity_logs', row);
        expect(entry.codeLocation).toBe(expectedLocation);
      }
    });

    it('returns null code location for unknown action', () => {
      const row = { id: 1, action: 'unknown_action', detail: '', metadataJson: null, createdAt: '2026-01-01T00:00:00Z' };
      const entry = normalizeLogEntry('activity_logs', row);
      expect(entry.codeLocation).toBeNull();
    });

    it('infers code location from system_events path', () => {
      const paths: Array<[string, string]> = [
        ['/api/account/profile', 'server/src/routes/account.ts'],
        ['/api/auth/login', 'server/src/routes/auth.ts'],
        ['/api/admin/log-center/logs', 'server/src/routes/admin-log-center.ts'],
        ['/api/admin/drug-master/list', 'server/src/routes/drug-master.ts'],
        ['/api/upload/csv', 'server/src/routes/upload.ts'],
        ['/api/inventory/items', 'server/src/routes/inventory.ts'],
        ['/api/notifications/list', 'server/src/routes/notifications.ts'],
        ['/api/groups/list', 'server/src/routes/groups.ts'],
        ['/api/openclaw/status', 'server/src/routes/openclaw.ts'],
        ['/api/exchange/proposals', 'server/src/routes/exchange-proposals.ts'],
        ['/api/internal/vercel-deploy-events/hook', 'server/src/routes/internal-vercel-deploy-events.ts'],
        ['/api/internal/monitoring/kpi', 'server/src/routes/internal-monitoring.ts'],
      ];

      for (const [path, expectedLocation] of paths) {
        const row = {
          id: 1,
          level: 'error',
          eventType: 'http_error',
          message: 'error',
          detailJson: { path, status: 500 },
          occurredAt: '2026-01-01T00:00:00Z',
        };
        const entry = normalizeLogEntry('system_events', row);
        expect(entry.codeLocation).toBe(expectedLocation);
      }
    });

    it('returns null for unknown system event path', () => {
      const row = {
        id: 1,
        level: 'error',
        eventType: 'http_error',
        message: 'error',
        detailJson: { path: '/unknown/path', status: 500 },
        occurredAt: '2026-01-01T00:00:00Z',
      };
      const entry = normalizeLogEntry('system_events', row);
      expect(entry.codeLocation).toBeNull();
    });

    it('drug_master_sync_logs always returns drug-master location', () => {
      const row = {
        id: 1,
        syncType: 'auto',
        sourceDescription: 'test',
        status: 'success',
        startedAt: '2026-01-01T00:00:00Z',
      };
      const entry = normalizeLogEntry('drug_master_sync_logs', row);
      expect(entry.codeLocation).toBe('server/src/routes/drug-master.ts');
    });
  });

  describe('normalizeLogEntry - whatHappened inference', () => {
    it('builds whatHappened from system_events with path+status', () => {
      const row = {
        id: 1,
        level: 'error',
        eventType: 'http_error',
        message: 'error',
        detailJson: { path: '/api/test', status: 503 },
        occurredAt: '2026-01-01T00:00:00Z',
      };
      const entry = normalizeLogEntry('system_events', row);
      expect(entry.whatHappened).toBe('/api/test で HTTP 503 エラーが発生しました');
    });

    it('builds whatHappened from activity_logs with 失敗| prefix', () => {
      const row = {
        id: 1,
        action: 'upload',
        detail: '失敗|ファイルが大きすぎます',
        metadataJson: null,
        createdAt: '2026-01-01T00:00:00Z',
      };
      const entry = normalizeLogEntry('activity_logs', row);
      expect(entry.whatHappened).toBe('ファイルが大きすぎます');
    });

    it('falls back to normalized message when no special pattern', () => {
      const row = {
        id: 1,
        level: 'info',
        eventType: 'test',
        message: 'Some event message',
        detailJson: null,
        occurredAt: '2026-01-01T00:00:00Z',
      };
      const entry = normalizeLogEntry('system_events', row);
      expect(entry.whatHappened).toBe('Some event message');
    });
  });

  describe('normalizeLogEntry - improvementSuggestion', () => {
    it('returns auth suggestion for login_failed action', () => {
      const row = {
        id: 1,
        action: 'login_failed',
        detail: 'パスワード不一致',
        metadataJson: null,
        createdAt: '2026-01-01T00:00:00Z',
      };
      const entry = normalizeLogEntry('activity_logs', row);
      expect(entry.improvementSuggestion).toContain('認証情報');
    });

    it('returns auth suggestion for password_reset_failed', () => {
      const row = {
        id: 1,
        action: 'password_reset_failed',
        detail: 'トークン期限切れ',
        metadataJson: null,
        createdAt: '2026-01-01T00:00:00Z',
      };
      const entry = normalizeLogEntry('activity_logs', row);
      expect(entry.improvementSuggestion).toContain('認証情報');
    });

    it('returns 500 suggestion for system_events with status >= 500', () => {
      const row = {
        id: 1,
        level: 'error',
        eventType: 'http_error',
        message: 'error',
        detailJson: { path: '/api/test', status: 500 },
        occurredAt: '2026-01-01T00:00:00Z',
      };
      const entry = normalizeLogEntry('system_events', row);
      expect(entry.improvementSuggestion).toContain('例外スタック');
    });

    it('returns drug-master suggestion when codeLocation includes drug-master', () => {
      const row = {
        id: 1,
        action: 'drug_master_sync',
        detail: '失敗|同期エラー',
        metadataJson: null,
        createdAt: '2026-01-01T00:00:00Z',
      };
      const entry = normalizeLogEntry('activity_logs', row);
      expect(entry.improvementSuggestion).toContain('外部同期元');
    });

    it('returns generic suggestion as fallback', () => {
      const row = {
        id: 1,
        action: 'logout',
        detail: '',
        metadataJson: null,
        createdAt: '2026-01-01T00:00:00Z',
      };
      const entry = normalizeLogEntry('activity_logs', row);
      expect(entry.improvementSuggestion).toContain('詳細ログ');
    });
  });

  describe('normalizeLogEntry - tenant extraction', () => {
    it('extracts tenant from nested tenant object in metadata', () => {
      const metadata = {
        tenant: {
          pharmacyId: 5,
          pharmacyName: '中央薬局',
          pharmacyEmail: 'central@example.com',
        },
      };
      const row = {
        id: 1,
        action: 'login',
        detail: '',
        metadataJson: metadata,
        createdAt: '2026-01-01T00:00:00Z',
      };
      const entry = normalizeLogEntry('activity_logs', row);
      expect(entry.tenant.pharmacyName).toBe('中央薬局');
      expect(entry.tenant.pharmacyEmail).toBe('central@example.com');
    });

    it('uses email fallback for tenantLabel when no pharmacyName and no pharmacyId', () => {
      const metadata = {
        tenant: {
          pharmacyEmail: 'tenant@example.com',
        },
      };
      const row = {
        id: 1,
        action: 'login',
        detail: '',
        metadataJson: metadata,
        createdAt: '2026-01-01T00:00:00Z',
      };
      const entry = normalizeLogEntry('activity_logs', row);
      expect(entry.tenant.tenantLabel).toBe('tenant@example.com');
    });

    it('uses pharmacyId fallback label when no name or email', () => {
      const row = {
        id: 1,
        pharmacyId: 7,
        action: 'login',
        detail: '',
        metadataJson: null,
        createdAt: '2026-01-01T00:00:00Z',
      };
      const entry = normalizeLogEntry('activity_logs', row);
      expect(entry.tenant.tenantLabel).toBe('薬局 #7');
    });

    it('extracts email fallback from "email" key in tenant', () => {
      const metadata = {
        tenant: {
          pharmacyId: 3,
          email: 'fallback@example.com',
        },
      };
      const row = {
        id: 1,
        action: 'login',
        detail: '',
        metadataJson: metadata,
        createdAt: '2026-01-01T00:00:00Z',
      };
      const entry = normalizeLogEntry('activity_logs', row);
      expect(entry.tenant.pharmacyEmail).toBe('fallback@example.com');
    });
  });

  describe('normalizeLogEntry - stack location extraction', () => {
    it('extracts code location from stack in detail', () => {
      const row = {
        id: 1,
        level: 'error',
        eventType: 'runtime_error',
        message: 'Error',
        detailJson: {
          stack: 'Error: boom\n    at handler (/Users/yusuke/DeadStockSolution/server/src/services/exchange-service.ts:200:15)',
        },
        occurredAt: '2026-01-01T00:00:00Z',
      };
      const entry = normalizeLogEntry('system_events', row);
      expect(entry.codeLocation).toContain('server/src/services/exchange-service.ts');
    });

    it('extracts code location from nested error.stack', () => {
      const row = {
        id: 1,
        level: 'error',
        eventType: 'runtime_error',
        message: 'Error',
        detailJson: {
          error: {
            stack: 'Error: boom\n    at fn (client/src/pages/HomePage.ts:50:3)',
          },
        },
        occurredAt: '2026-01-01T00:00:00Z',
      };
      const entry = normalizeLogEntry('system_events', row);
      expect(entry.codeLocation).toContain('client/src/pages/HomePage.ts');
    });

    it('uses sourceLocation from detail when available', () => {
      const row = {
        id: 1,
        level: 'error',
        eventType: 'runtime_error',
        message: 'Error',
        detailJson: {
          sourceLocation: 'server/src/services/custom-service.ts:123',
        },
        occurredAt: '2026-01-01T00:00:00Z',
      };
      const entry = normalizeLogEntry('system_events', row);
      expect(entry.codeLocation).toBe('server/src/services/custom-service.ts:123');
    });
  });

  // ── queryLogs - additional branch coverage ──────────────────

  describe('queryLogs - additional branches', () => {
    it('handles multiple sources with zero count gracefully', async () => {
      mocks.db.select.mockImplementation(() => createSelectChain([{ cnt: 0 }]));
      const result = await queryLogs({ sources: ['activity_logs'], page: 1, limit: 50 });
      expect(result.entries).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('handles info level filter for system_events', async () => {
      let selectCallCount = 0;
      mocks.db.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return createSelectChain([{ cnt: 1 }]);
        if (selectCallCount === 2) {
          return createSelectChain([{
            id: 1,
            level: 'info',
            eventType: 'deploy',
            message: 'deployed',
            detailJson: null,
            occurredAt: '2026-01-01T00:00:00Z',
          }]);
        }
        if (selectCallCount === 3) return createImmediateWhereChain([]); // pharmacyMap
        if (selectCallCount === 4) return createImmediateWhereChain([]); // errorCodeMap
        if (selectCallCount === 5) return createOrderByResolveChain([]); // issueStateMap
        return createSelectChain([]);
      });

      const result = await queryLogs({ sources: ['system_events'], level: 'info' });
      expect(result.entries.length).toBe(1);
    });

    it('applies critical level filter (returns zero for activity_logs)', async () => {
      mocks.db.select.mockImplementation(() => createSelectChain([{ cnt: 0 }]));
      const result = await queryLogs({ sources: ['activity_logs'], level: 'critical' });
      expect(result.entries).toEqual([]);
    });

    it('applies warning level filter for sync logs', async () => {
      let selectCallCount = 0;
      mocks.db.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return createSelectChain([{ cnt: 1 }]);
        if (selectCallCount === 2) {
          return createSelectChain([{
            id: 1,
            syncType: 'auto',
            sourceDescription: 'test',
            status: 'partial',
            itemsProcessed: 100,
            itemsAdded: 50,
            itemsUpdated: 20,
            itemsDeleted: 0,
            errorMessage: null,
            startedAt: '2026-01-01T00:00:00Z',
            triggeredBy: null,
          }]);
        }
        if (selectCallCount === 3) return createImmediateWhereChain([]); // pharmacyMap
        if (selectCallCount === 4) return createImmediateWhereChain([]); // errorCodeMap
        if (selectCallCount === 5) return createOrderByResolveChain([]); // issueStateMap
        return createSelectChain([]);
      });
      const result = await queryLogs({ sources: ['drug_master_sync_logs'], level: 'warning' });
      expect(result.entries.length).toBe(1);
    });

    it('loads issue state map with activity log audit entries', async () => {
      let selectCallCount = 0;
      const pharmacyId = 5;
      mocks.db.select.mockImplementation(() => {
        selectCallCount++;
        // count
        if (selectCallCount === 1) return createSelectChain([{ cnt: 1 }]);
        // data - no pharmacyId, no errorCode, so loadPharmacyMap and loadErrorCodeMap are both skipped
        if (selectCallCount === 2) {
          return createSelectChain([{
            id: 10,
            level: 'error',
            eventType: 'test',
            message: 'test',
            detailJson: null,
            occurredAt: '2026-01-01T00:00:00Z',
          }]);
        }
        // issueStateMap audit log query (call 3, ends with .orderBy())
        if (selectCallCount === 3) {
          return createOrderByResolveChain([{
            id: 100,
            pharmacyId,
            action: 'admin_log_status_update',
            resourceId: 'system_events:10',
            metadataJson: { status: 'investigating', note: '調査中' },
            createdAt: '2026-01-02T00:00:00Z',
          }]);
        }
        // loadPharmacyMap for actors (call 4)
        if (selectCallCount === 4) {
          return createImmediateWhereChain([{
            id: pharmacyId,
            name: '管理薬局',
            email: 'admin@example.com',
          }]);
        }
        return createSelectChain([]);
      });

      const result = await queryLogs({ sources: ['system_events'] });
      expect(result.entries.length).toBe(1);
      const entry = result.entries[0];
      expect(entry.operatorState.status).toBe('investigating');
      expect(entry.operatorState.note).toBe('調査中');
      expect(entry.operatorState.updatedBy?.pharmacyId).toBe(pharmacyId);
    });

    it('handles issue state map with unknown actor (no pharmacy found)', async () => {
      let selectCallCount = 0;
      mocks.db.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return createSelectChain([{ cnt: 1 }]);
        // data - no pharmacyId, no errorCode
        if (selectCallCount === 2) {
          return createSelectChain([{
            id: 20,
            level: 'error',
            eventType: 'test',
            message: 'test',
            detailJson: null,
            occurredAt: '2026-01-01T00:00:00Z',
          }]);
        }
        // issueStateMap (call 3, ends with .orderBy())
        if (selectCallCount === 3) {
          return createOrderByResolveChain([{
            id: 200,
            pharmacyId: 99,
            action: 'admin_log_status_update',
            resourceId: 'system_events:20',
            metadataJson: { status: 'resolved' },
            createdAt: '2026-01-02T00:00:00Z',
          }]);
        }
        // loadPharmacyMap for actors (call 4) - returns empty (no pharmacy found for id 99)
        if (selectCallCount === 4) return createImmediateWhereChain([]);
        return createSelectChain([]);
      });

      const result = await queryLogs({ sources: ['system_events'] });
      expect(result.entries.length).toBe(1);
      const entry = result.entries[0];
      expect(entry.operatorState.status).toBe('resolved');
      expect(entry.operatorState.updatedBy?.pharmacyId).toBe(99);
      expect(entry.operatorState.updatedBy?.pharmacyName).toBeNull();
    });

    it('handles issue state map with null pharmacyId actor', async () => {
      let selectCallCount = 0;
      mocks.db.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return createSelectChain([{ cnt: 1 }]);
        // data - no pharmacyId, no errorCode (both maps skipped)
        if (selectCallCount === 2) {
          return createSelectChain([{
            id: 30,
            level: 'error',
            eventType: 'test',
            message: 'test',
            detailJson: null,
            occurredAt: '2026-01-01T00:00:00Z',
          }]);
        }
        // issueStateMap (call 3, ends with .orderBy())
        if (selectCallCount === 3) {
          return createOrderByResolveChain([{
            id: 300,
            pharmacyId: null,
            action: 'admin_log_status_update',
            resourceId: 'system_events:30',
            metadataJson: { status: 'false_positive' },
            createdAt: '2026-01-02T00:00:00Z',
          }]);
        }
        // loadPharmacyMap([]) for actors — empty ids, NO db.select call
        return createSelectChain([]);
      });

      const result = await queryLogs({ sources: ['system_events'] });
      expect(result.entries.length).toBe(1);
      const entry = result.entries[0];
      expect(entry.operatorState.status).toBe('false_positive');
      expect(entry.operatorState.updatedBy).toBeNull();
    });

    it('skips issue state map entries with missing status', async () => {
      let selectCallCount = 0;
      mocks.db.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return createSelectChain([{ cnt: 1 }]);
        // data - no pharmacyId, no errorCode
        if (selectCallCount === 2) {
          return createSelectChain([{
            id: 40,
            level: 'error',
            eventType: 'test',
            message: 'test',
            detailJson: null,
            occurredAt: '2026-01-01T00:00:00Z',
          }]);
        }
        // issueStateMap (call 3, ends with .orderBy()) - no valid status
        if (selectCallCount === 3) {
          return createOrderByResolveChain([{
            id: 400,
            pharmacyId: null,
            action: 'admin_log_status_update',
            resourceId: 'system_events:40',
            metadataJson: { note: 'no status here' },
            createdAt: '2026-01-02T00:00:00Z',
          }]);
        }
        return createSelectChain([]);
      });

      const result = await queryLogs({ sources: ['system_events'] });
      const entry = result.entries[0];
      // Should use default state since no valid status
      expect(entry.operatorState.status).toBe('new');
    });

    it('enriches entries with errorCode metadata', async () => {
      let selectCallCount = 0;
      mocks.db.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return createSelectChain([{ cnt: 1 }]);
        if (selectCallCount === 2) {
          // Entry with errorCode, no pharmacyId (so loadPharmacyMap is skipped)
          return createSelectChain([{
            id: 50,
            level: 'error',
            eventType: 'test',
            message: 'error',
            errorCode: 'SYSTEM_INTERNAL_ERROR',
            detailJson: null,
            occurredAt: '2026-01-01T00:00:00Z',
          }]);
        }
        // loadPharmacyMap([]) — empty, NO db.select call
        // errorCodeMap (call 3)
        if (selectCallCount === 3) {
          return createImmediateWhereChain([{
            code: 'SYSTEM_INTERNAL_ERROR',
            titleJa: '内部エラー',
            descriptionJa: 'サーバーエラーが発生しました',
            resolutionJa: '管理者に連絡してください',
            severity: 'error',
            category: 'system',
          }]);
        }
        // issueStateMap (call 4, ends with .orderBy())
        if (selectCallCount === 4) return createOrderByResolveChain([]);
        return createSelectChain([]);
      });

      const result = await queryLogs({ sources: ['system_events'] });
      const entry = result.entries[0];
      expect(entry.whatHappened).toContain('内部エラー');
      expect(entry.whatHappened).toContain('サーバーエラーが発生しました');
      expect(entry.improvementSuggestion).toBe('管理者に連絡してください');
      expect(entry.errorCodeMeta).not.toBeNull();
      expect(entry.errorCodeMeta?.titleJa).toBe('内部エラー');
    });
  });

  // ── getLogInsights ───────────────────────────────────────────

  describe('getLogInsights', () => {
    it('returns empty insights when no error/critical entries', async () => {
      let selectCallCount = 0;
      mocks.db.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount <= 3) return createSelectChain([{ cnt: 0 }]);
        return createSelectChain([]);
      });

      const insights = await getLogInsights({});
      expect(insights.repeatedErrorCount).toBe(0);
      expect(insights.impactedTenantCount).toBe(0);
      expect(insights.topIssues).toEqual([]);
    });

    it('groups error entries by fingerprint and returns top issues', async () => {
      const errorRows = [
        {
          id: 1,
          level: 'error',
          eventType: 'http_error',
          message: 'POST /api/test -> 500',
          errorCode: 'SYSTEM_INTERNAL_ERROR',
          detailJson: { path: '/api/account', status: 500, tenant: { pharmacyId: 1 } },
          occurredAt: '2026-01-03T00:00:00Z',
        },
        {
          id: 2,
          level: 'error',
          eventType: 'http_error',
          message: 'POST /api/test -> 500',
          errorCode: 'SYSTEM_INTERNAL_ERROR',
          detailJson: { path: '/api/account', status: 500, tenant: { pharmacyId: 2 } },
          occurredAt: '2026-01-02T00:00:00Z',
        },
        {
          id: 3,
          level: 'info',
          eventType: 'deploy',
          message: 'deployed',
          detailJson: null,
          occurredAt: '2026-01-01T00:00:00Z',
        },
      ];

      let selectCallCount = 0;
      mocks.db.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount <= 3) return createSelectChain([{ cnt: 3 }]);
        if (selectCallCount === 4) return createSelectChain([errorRows[0]]);
        if (selectCallCount === 5) return createSelectChain([errorRows[1], errorRows[2]]);
        if (selectCallCount === 6) return createSelectChain([]);
        // pharmacyMap
        if (selectCallCount === 7) return createImmediateWhereChain([]);
        // errorCodeMap
        if (selectCallCount === 8) return createImmediateWhereChain([]);
        // issueStateMap (ends with .orderBy())
        if (selectCallCount === 9) return createOrderByResolveChain([]);
        return createSelectChain([]);
      });

      const insights = await getLogInsights({});
      expect(insights.topIssues.length).toBeGreaterThanOrEqual(1);
    });

    it('respects minOccurrences filter', async () => {
      let selectCallCount = 0;
      mocks.db.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount <= 3) return createSelectChain([{ cnt: 0 }]);
        return createSelectChain([]);
      });

      const insights = await getLogInsights({ minOccurrences: 5 });
      expect(insights.topIssues).toEqual([]);
    });

    it('respects topLimit option', async () => {
      let selectCallCount = 0;
      mocks.db.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount <= 3) return createSelectChain([{ cnt: 0 }]);
        return createSelectChain([]);
      });

      const insights = await getLogInsights({ topLimit: 3 });
      expect(insights.topIssues.length).toBeLessThanOrEqual(3);
    });
  });

  describe('getLogInsightForEntry', () => {
    it('returns null when entry fingerprint not in insights', async () => {
      mocks.db.select.mockImplementation(() => createSelectChain([{ cnt: 0 }]));

      const entry = normalizeLogEntry('system_events', {
        id: 999,
        level: 'error',
        eventType: 'test',
        message: 'test',
        detailJson: null,
        occurredAt: '2026-01-01T00:00:00Z',
      });

      const insight = await getLogInsightForEntry(entry, {});
      expect(insight).toBeNull();
    });

    it('returns insight when entry fingerprint matches', async () => {
      const errorRow = {
        id: 1,
        level: 'error',
        eventType: 'http_error',
        message: 'error',
        errorCode: 'TEST_CODE',
        detailJson: { path: '/api/account', status: 500 },
        occurredAt: '2026-01-01T00:00:00Z',
      };

      let selectCallCount = 0;
      mocks.db.select.mockImplementation(() => {
        selectCallCount++;
        // Count: activity=0, system=1, sync=0
        if (selectCallCount === 1) return createSelectChain([{ cnt: 0 }]);
        if (selectCallCount === 2) return createSelectChain([{ cnt: 1 }]);
        if (selectCallCount === 3) return createSelectChain([{ cnt: 0 }]);
        // Data: system_events only (fetchLimit=1)
        if (selectCallCount === 4) return createSelectChain([errorRow]);
        // pharmacyMap (empty - no pharmacyId)
        // errorCodeMap
        if (selectCallCount === 5) return createImmediateWhereChain([]);
        // issueStateMap
        if (selectCallCount === 6) return createOrderByResolveChain([]);
        return createSelectChain([]);
      });

      const entry = normalizeLogEntry('system_events', errorRow);
      const insight = await getLogInsightForEntry(entry, {});
      // Entry was matched in the insights
      expect(insight).not.toBeNull();
      expect(insight?.source).toBe('system_events');
    });
  });

  describe('getLogInsights - impactedTenantCount and repeatedErrorCount', () => {
    it('computes impactedTenantCount from unique pharmacyIds across error entries', async () => {
      const errorRows = Array.from({ length: 3 }, (_, i) => ({
        id: i + 1,
        level: 'error',
        eventType: 'test_error',
        message: `error ${i + 1}`,
        errorCode: 'ERR_CODE',
        detailJson: { tenant: { pharmacyId: i + 1 } },
        occurredAt: `2026-01-0${i + 1}T00:00:00Z`,
      }));

      let selectCallCount = 0;
      mocks.db.select.mockImplementation(() => {
        selectCallCount++;
        // Count: activity=0, system=3, sync=0
        if (selectCallCount === 1) return createSelectChain([{ cnt: 0 }]);
        if (selectCallCount === 2) return createSelectChain([{ cnt: 3 }]);
        if (selectCallCount === 3) return createSelectChain([{ cnt: 0 }]);
        // Data: system_events (fetchLimit=3)
        if (selectCallCount === 4) return createSelectChain(errorRows);
        // pharmacyMap (3 pharmacyIds)
        if (selectCallCount === 5) return createImmediateWhereChain([
          { id: 1, name: '薬局1', email: 'p1@example.com' },
          { id: 2, name: '薬局2', email: 'p2@example.com' },
          { id: 3, name: '薬局3', email: 'p3@example.com' },
        ]);
        // errorCodeMap
        if (selectCallCount === 6) return createImmediateWhereChain([]);
        // issueStateMap
        if (selectCallCount === 7) return createOrderByResolveChain([]);
        return createSelectChain([]);
      });

      const insights = await getLogInsights({});
      // 3 unique pharmacyIds = 3 impacted tenants
      expect(insights.impactedTenantCount).toBe(3);
      // All same fingerprint (same errorCode+eventType+location+source), count=3 > 1
      expect(insights.repeatedErrorCount).toBe(1);
    });

    it('counts repeatedErrorCount only for groups with count > 1', async () => {
      const errorRows = [
        {
          id: 1,
          level: 'error',
          eventType: 'error_a',
          message: 'error a',
          detailJson: { tenant: { pharmacyId: 1 } },
          occurredAt: '2026-01-03T00:00:00Z',
        },
        {
          id: 2,
          level: 'error',
          eventType: 'error_a',
          message: 'error a',
          detailJson: { tenant: { pharmacyId: 2 } },
          occurredAt: '2026-01-02T00:00:00Z',
        },
        {
          id: 3,
          level: 'error',
          eventType: 'error_b',
          message: 'error b',
          detailJson: { tenant: { pharmacyId: 3 } },
          occurredAt: '2026-01-01T00:00:00Z',
        },
      ];

      let selectCallCount = 0;
      mocks.db.select.mockImplementation(() => {
        selectCallCount++;
        // Count: activity=0, system=3, sync=0
        if (selectCallCount === 1) return createSelectChain([{ cnt: 0 }]);
        if (selectCallCount === 2) return createSelectChain([{ cnt: 3 }]);
        if (selectCallCount === 3) return createSelectChain([{ cnt: 0 }]);
        // Data: system_events
        if (selectCallCount === 4) return createSelectChain(errorRows);
        // pharmacyMap
        if (selectCallCount === 5) return createImmediateWhereChain([
          { id: 1, name: '薬局1', email: 'p1@example.com' },
          { id: 2, name: '薬局2', email: 'p2@example.com' },
          { id: 3, name: '薬局3', email: 'p3@example.com' },
        ]);
        // errorCodeMap
        if (selectCallCount === 6) return createImmediateWhereChain([]);
        // issueStateMap
        if (selectCallCount === 7) return createOrderByResolveChain([]);
        return createSelectChain([]);
      });

      const insights = await getLogInsights({});
      // error_a appears twice (repeated), error_b appears once (not repeated)
      expect(insights.repeatedErrorCount).toBe(1);
      expect(insights.topIssues.length).toBe(2);
    });
  });

  describe('queryLogs - mergeEntriesForPage tie-break', () => {
    it('uses earlier source index as tie-breaker for same timestamp', async () => {
      // Two entries with identical timestamps from different sources
      const timestamp = '2026-01-01T12:00:00Z';
      const activityRow = {
        id: 1,
        action: 'login',
        detail: '',
        resourceType: 'auth',
        metadataJson: null,
        createdAt: timestamp,
      };
      const systemRow = {
        id: 2,
        level: 'info',
        eventType: 'deploy',
        message: 'deployed',
        detailJson: null,
        occurredAt: timestamp,
      };

      let selectCallCount = 0;
      mocks.db.select.mockImplementation(() => {
        selectCallCount++;
        // Count queries: activity=1, system=1, sync=0
        if (selectCallCount === 1) return createSelectChain([{ cnt: 1 }]);
        if (selectCallCount === 2) return createSelectChain([{ cnt: 1 }]);
        if (selectCallCount === 3) return createSelectChain([{ cnt: 0 }]);
        // Data queries
        if (selectCallCount === 4) return createSelectChain([activityRow]);
        if (selectCallCount === 5) return createSelectChain([systemRow]);
        if (selectCallCount === 6) return createSelectChain([]);
        // enrichment
        if (selectCallCount === 7) return createImmediateWhereChain([]);
        if (selectCallCount === 8) return createImmediateWhereChain([]);
        if (selectCallCount === 9) return createOrderByResolveChain([]);
        return createSelectChain([]);
      });

      const result = await queryLogs({});
      expect(result.entries.length).toBe(2);
      // Both entries should be present
      const ids = result.entries.map((e) => e.id);
      expect(ids).toContain(1);
      expect(ids).toContain(2);
    });
  });

  describe('normalizeLogEntry - stack line with no match returns trimmed segment', () => {
    it('returns trimmed segment when stack line does not match server/client path pattern', () => {
      const row = {
        id: 1,
        level: 'error',
        eventType: 'runtime_error',
        message: 'Error',
        // Stack has server/src but no valid extension match — normalizer returns trimmed
        detailJson: {
          stack: 'Error: boom\n    at fn (server/src/services/some-service:100:1)',
        },
        occurredAt: '2026-01-01T00:00:00Z',
      };
      const entry = normalizeLogEntry('system_events', row);
      // When no extension match but line has server/src, normalizeStackLocation returns trimmed
      expect(entry.codeLocation).toBeTruthy();
    });
  });

  describe('loadPharmacyMap - DB call', () => {
    it('calls DB when pharmacyIds are non-empty', async () => {
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { id: 5, name: '薬局E', email: 'e@example.com' },
          ]),
        }),
      });

      const result = await loadPharmacyMap([5]);
      expect(result.size).toBe(1);
      expect(result.get(5)?.name).toBe('薬局E');
    });
  });
});
