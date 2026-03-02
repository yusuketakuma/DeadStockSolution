import { describe, it, expect } from 'vitest';
import { normalizeLogEntry, LOG_SOURCES } from '../services/log-center-service';

describe('log-center-service', () => {
  describe('LOG_SOURCES', () => {
    it('should include all three log sources', () => {
      expect(LOG_SOURCES).toContain('activity_logs');
      expect(LOG_SOURCES).toContain('system_events');
      expect(LOG_SOURCES).toContain('drug_master_sync_logs');
    });

    it('should have exactly 3 sources', () => {
      expect(LOG_SOURCES).toHaveLength(3);
    });
  });

  describe('normalizeLogEntry', () => {
    // ── activity_logs ──────────────────────────────

    describe('activity_logs', () => {
      it('should detect error level when detail starts with 失敗|', () => {
        const row = {
          id: 1,
          pharmacyId: 10,
          action: 'upload',
          detail: '失敗|ファイル形式が不正です',
          resourceType: 'dead_stock',
          resourceId: '42',
          metadataJson: null,
          ipAddress: '127.0.0.1',
          errorCode: 'UPLOAD_PARSE_ERR',
          createdAt: '2026-03-01T10:00:00.000Z',
        };

        const entry = normalizeLogEntry('activity_logs', row);

        expect(entry.id).toBe(1);
        expect(entry.source).toBe('activity_logs');
        expect(entry.level).toBe('error');
        expect(entry.message).toBe('[upload] 失敗|ファイル形式が不正です');
        expect(entry.errorCode).toBe('UPLOAD_PARSE_ERR');
        expect(entry.pharmacyId).toBe(10);
        expect(entry.timestamp).toBe('2026-03-01T10:00:00.000Z');
        expect(entry.category).toBe('dead_stock');
      });

      it('should detect warning level for login_failed action', () => {
        const row = {
          id: 2,
          pharmacyId: 5,
          action: 'login_failed',
          detail: 'パスワード不一致',
          resourceType: null,
          metadataJson: null,
          createdAt: '2026-03-01T11:00:00.000Z',
        };

        const entry = normalizeLogEntry('activity_logs', row);

        expect(entry.level).toBe('warning');
        expect(entry.message).toBe('[login_failed] パスワード不一致');
      });

      it('should detect warning level for password_reset_failed action', () => {
        const row = {
          id: 3,
          pharmacyId: null,
          action: 'password_reset_failed',
          detail: 'トークン期限切れ',
          metadataJson: null,
          createdAt: '2026-03-01T12:00:00.000Z',
        };

        const entry = normalizeLogEntry('activity_logs', row);

        expect(entry.level).toBe('warning');
        expect(entry.pharmacyId).toBeNull();
      });

      it('should default to info level for normal actions', () => {
        const row = {
          id: 4,
          pharmacyId: 1,
          action: 'login',
          detail: 'ログイン成功',
          resourceType: 'auth',
          metadataJson: '{"browser":"Chrome"}',
          createdAt: '2026-03-01T09:00:00.000Z',
        };

        const entry = normalizeLogEntry('activity_logs', row);

        expect(entry.level).toBe('info');
        expect(entry.message).toBe('[login] ログイン成功');
        expect(entry.detail).toEqual({ browser: 'Chrome' });
      });

      it('should use action as category when resourceType is null', () => {
        const row = {
          id: 5,
          action: 'logout',
          detail: '',
          resourceType: null,
          metadataJson: null,
          createdAt: '2026-03-01T13:00:00.000Z',
        };

        const entry = normalizeLogEntry('activity_logs', row);

        expect(entry.category).toBe('logout');
      });

      it('should handle null detail without error', () => {
        const row = {
          id: 6,
          action: 'register',
          detail: null,
          metadataJson: null,
          createdAt: '2026-03-01T14:00:00.000Z',
        };

        const entry = normalizeLogEntry('activity_logs', row);

        expect(entry.level).toBe('info');
        expect(entry.message).toBe('[register] ');
      });

      it('should parse metadataJson string as JSON detail', () => {
        const metadata = { userId: 42, role: 'admin' };
        const row = {
          id: 7,
          action: 'admin_login',
          detail: '管理者ログイン',
          metadataJson: JSON.stringify(metadata),
          createdAt: '2026-03-01T15:00:00.000Z',
        };

        const entry = normalizeLogEntry('activity_logs', row);

        expect(entry.detail).toEqual(metadata);
      });

      it('should prioritize 失敗| error level over login_failed warning', () => {
        // Edge case: detail starts with 失敗| AND action is login_failed
        const row = {
          id: 8,
          action: 'login_failed',
          detail: '失敗|認証エラー',
          metadataJson: null,
          createdAt: '2026-03-01T16:00:00.000Z',
        };

        const entry = normalizeLogEntry('activity_logs', row);

        // 失敗| prefix takes precedence (error > warning)
        expect(entry.level).toBe('error');
      });
    });

    // ── system_events ──────────────────────────────

    describe('system_events', () => {
      it('should pass through level and errorCode from row', () => {
        const row = {
          id: 100,
          source: 'runtime_error',
          level: 'error',
          eventType: 'unhandled_exception',
          message: 'Cannot read property of undefined',
          detailJson: '{"stack":"Error at ..."}',
          errorCode: 'SYS_RUNTIME_ERR',
          occurredAt: '2026-03-01T10:30:00.000Z',
        };

        const entry = normalizeLogEntry('system_events', row);

        expect(entry.id).toBe(100);
        expect(entry.source).toBe('system_events');
        expect(entry.level).toBe('error');
        expect(entry.category).toBe('unhandled_exception');
        expect(entry.errorCode).toBe('SYS_RUNTIME_ERR');
        expect(entry.message).toBe('Cannot read property of undefined');
        expect(entry.detail).toEqual({ stack: 'Error at ...' });
        expect(entry.timestamp).toBe('2026-03-01T10:30:00.000Z');
        expect(entry.pharmacyId).toBeNull();
      });

      it('should handle warning level events', () => {
        const row = {
          id: 101,
          source: 'vercel_deploy',
          level: 'warning',
          eventType: 'deploy_warning',
          message: 'デプロイ警告: レスポンス遅延',
          detailJson: null,
          errorCode: null,
          occurredAt: '2026-03-01T11:00:00.000Z',
        };

        const entry = normalizeLogEntry('system_events', row);

        expect(entry.level).toBe('warning');
        expect(entry.errorCode).toBeNull();
        expect(entry.detail).toBeNull();
      });

      it('should handle info level events', () => {
        const row = {
          id: 102,
          source: 'vercel_deploy',
          level: 'info',
          eventType: 'deploy_success',
          message: 'デプロイ完了',
          detailJson: null,
          occurredAt: '2026-03-01T12:00:00.000Z',
        };

        const entry = normalizeLogEntry('system_events', row);

        expect(entry.level).toBe('info');
      });

      it('should parse detailJson as structured detail', () => {
        const detailObj = { url: '/api/test', statusCode: 500 };
        const row = {
          id: 103,
          level: 'error',
          eventType: 'api_error',
          message: 'API error',
          detailJson: JSON.stringify(detailObj),
          occurredAt: '2026-03-01T13:00:00.000Z',
        };

        const entry = normalizeLogEntry('system_events', row);

        expect(entry.detail).toEqual(detailObj);
      });
    });

    // ── drug_master_sync_logs ──────────────────────

    describe('drug_master_sync_logs', () => {
      it('should detect error level and SYNC_MASTER_FAILED for failed status', () => {
        const row = {
          id: 200,
          syncType: 'auto',
          sourceDescription: '厚生労働省 薬価基準 2026年4月',
          status: 'failed',
          itemsProcessed: 100,
          itemsAdded: 0,
          itemsUpdated: 0,
          itemsDeleted: 0,
          errorMessage: 'ネットワークエラー',
          startedAt: '2026-03-01T03:00:00.000Z',
          triggeredBy: null,
        };

        const entry = normalizeLogEntry('drug_master_sync_logs', row);

        expect(entry.id).toBe(200);
        expect(entry.source).toBe('drug_master_sync_logs');
        expect(entry.level).toBe('error');
        expect(entry.errorCode).toBe('SYNC_MASTER_FAILED');
        expect(entry.message).toBe('[sync:auto] 厚生労働省 薬価基準 2026年4月 — failed');
        expect(entry.category).toBe('drug_master_sync');
        expect(entry.pharmacyId).toBeNull();
        expect(entry.timestamp).toBe('2026-03-01T03:00:00.000Z');
        expect(entry.detail).toEqual({
          itemsProcessed: 100,
          itemsAdded: 0,
          itemsUpdated: 0,
          itemsDeleted: 0,
          errorMessage: 'ネットワークエラー',
        });
      });

      it('should detect warning level for partial status', () => {
        const row = {
          id: 201,
          syncType: 'manual',
          sourceDescription: '手動インポート',
          status: 'partial',
          itemsProcessed: 500,
          itemsAdded: 300,
          itemsUpdated: 100,
          itemsDeleted: 0,
          errorMessage: '一部レコードでパースエラー',
          startedAt: '2026-03-01T04:00:00.000Z',
          triggeredBy: 1,
        };

        const entry = normalizeLogEntry('drug_master_sync_logs', row);

        expect(entry.level).toBe('warning');
        expect(entry.errorCode).toBeNull();
        expect(entry.message).toBe('[sync:manual] 手動インポート — partial');
        expect(entry.pharmacyId).toBe(1);
      });

      it('should detect info level for success status', () => {
        const row = {
          id: 202,
          syncType: 'auto',
          sourceDescription: '定期更新',
          status: 'success',
          itemsProcessed: 1000,
          itemsAdded: 50,
          itemsUpdated: 200,
          itemsDeleted: 10,
          errorMessage: null,
          startedAt: '2026-03-01T05:00:00.000Z',
          triggeredBy: null,
        };

        const entry = normalizeLogEntry('drug_master_sync_logs', row);

        expect(entry.level).toBe('info');
        expect(entry.errorCode).toBeNull();
        expect(entry.message).toBe('[sync:auto] 定期更新 — success');
      });

      it('should detect info level for running status', () => {
        const row = {
          id: 203,
          syncType: 'auto',
          sourceDescription: '処理中',
          status: 'running',
          itemsProcessed: 0,
          itemsAdded: 0,
          itemsUpdated: 0,
          itemsDeleted: 0,
          errorMessage: null,
          startedAt: '2026-03-01T06:00:00.000Z',
          triggeredBy: 2,
        };

        const entry = normalizeLogEntry('drug_master_sync_logs', row);

        expect(entry.level).toBe('info');
        expect(entry.pharmacyId).toBe(2);
      });

      it('should handle null sourceDescription', () => {
        const row = {
          id: 204,
          syncType: 'manual',
          sourceDescription: null,
          status: 'success',
          itemsProcessed: 10,
          startedAt: '2026-03-01T07:00:00.000Z',
        };

        const entry = normalizeLogEntry('drug_master_sync_logs', row);

        // null sourceDescription should be stringified as empty-ish
        expect(entry.message).toContain('[sync:manual]');
        expect(entry.message).toContain('— success');
      });
    });

    // ── 共通動作 ──────────────────────────────────

    describe('common behavior', () => {
      it('should always return a valid NormalizedLogEntry shape', () => {
        const sources = [
          {
            source: 'activity_logs' as const,
            row: { id: 1, action: 'test', detail: '', createdAt: '2026-01-01T00:00:00Z' },
          },
          {
            source: 'system_events' as const,
            row: { id: 2, level: 'info', eventType: 'test', message: 'msg', occurredAt: '2026-01-01T00:00:00Z' },
          },
          {
            source: 'drug_master_sync_logs' as const,
            row: { id: 3, syncType: 'auto', status: 'success', startedAt: '2026-01-01T00:00:00Z' },
          },
        ];

        for (const { source, row } of sources) {
          const entry = normalizeLogEntry(source, row);

          expect(entry).toHaveProperty('id');
          expect(entry).toHaveProperty('source');
          expect(entry).toHaveProperty('level');
          expect(entry).toHaveProperty('category');
          expect(entry).toHaveProperty('errorCode');
          expect(entry).toHaveProperty('message');
          expect(entry).toHaveProperty('detail');
          expect(entry).toHaveProperty('pharmacyId');
          expect(entry).toHaveProperty('timestamp');
          expect(typeof entry.id).toBe('number');
          expect(typeof entry.source).toBe('string');
          expect(['critical', 'error', 'warning', 'info']).toContain(entry.level);
          expect(typeof entry.message).toBe('string');
          expect(typeof entry.timestamp).toBe('string');
        }
      });

      it('should handle invalid JSON in metadata gracefully', () => {
        const row = {
          id: 99,
          action: 'test',
          detail: 'テスト',
          metadataJson: '{invalid json',
          createdAt: '2026-01-01T00:00:00Z',
        };

        const entry = normalizeLogEntry('activity_logs', row);

        // Invalid JSON should be returned as-is (string)
        expect(entry.detail).toBe('{invalid json');
      });
    });
  });
});
