import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    insert: vi.fn(),
    update: vi.fn(),
    select: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../services/upload-confirm-job-service', () => ({
  cancelUploadConfirmJobByAdmin: vi.fn(async (jobId: number, canceledBy: number) => ({
    id: jobId,
    status: 'cancel_requested',
    canceledAt: null,
    cancelRequestedAt: '2026-01-01T00:00:00.000Z',
    cancelable: true,
    canceledBy,
  })),
}));

vi.mock('../services/drug-master-scheduler', () => ({
  triggerManualAutoSync: vi.fn(async () => ({ triggered: true, message: 'ok' })),
  startDrugMasterScheduler: vi.fn(),
  stopDrugMasterScheduler: vi.fn(),
}));

vi.mock('../services/drug-package-scheduler', () => ({
  triggerManualPackageAutoSync: vi.fn(async () => ({ triggered: true, message: 'ok' })),
  startDrugPackageScheduler: vi.fn(),
  stopDrugPackageScheduler: vi.fn(),
}));

vi.mock('../services/import-failure-alert-scheduler', () => ({
  startImportFailureAlertScheduler: vi.fn(),
  stopImportFailureAlertScheduler: vi.fn(),
}));

vi.mock('../services/matching-refresh-scheduler', () => ({
  startMatchingRefreshScheduler: vi.fn(),
  stopMatchingRefreshScheduler: vi.fn(),
}));

vi.mock('../services/monthly-report-scheduler', () => ({
  startMonthlyReportScheduler: vi.fn(),
  stopMonthlyReportScheduler: vi.fn(),
}));

vi.mock('../services/monitoring-kpi-alert-scheduler', () => ({
  startMonitoringKpiAlertScheduler: vi.fn(),
  stopMonitoringKpiAlertScheduler: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
}));

// Must import after mocks
import { executeCommand, listCommandHistory, BUILTIN_COMMANDS } from '../services/openclaw-command-service';

describe('openclaw-command-service — additional coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('executeCommand', () => {
    it('executes a known read command (system.status)', async () => {
      const insertReturning = vi.fn().mockResolvedValue([{ id: 1, commandName: 'system.status', status: 'received' }]);
      const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
      mocks.db.insert.mockReturnValue({ values: insertValues });

      const updateWhere = vi.fn().mockResolvedValue(undefined);
      const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
      mocks.db.update.mockReturnValue({ set: updateSet });

      const result = await executeCommand(
        { command: 'system.status', parameters: {} },
        'test-signature',
      );

      expect(result.status).toBe('completed');
      expect(result.command).toBe('system.status');
      expect(result.result).toEqual(expect.objectContaining({
        status: 'operational',
      }));
    });

    it('rejects command not in whitelist', async () => {
      const insertReturning = vi.fn().mockResolvedValue([{ id: 2, commandName: 'evil.command', status: 'received' }]);
      const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
      mocks.db.insert.mockReturnValue({ values: insertValues });

      const updateWhere = vi.fn().mockResolvedValue(undefined);
      const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
      mocks.db.update.mockReturnValue({ set: updateSet });

      const result = await executeCommand(
        { command: 'evil.command', parameters: {} },
        'test-signature',
      );

      expect(result.status).toBe('rejected');
      expect(result.errorMessage).toContain('許可リスト');
    });

    it('handles command handler failure', async () => {
      const insertReturning = vi.fn().mockResolvedValue([{ id: 3, commandName: 'cache.clear', status: 'received' }]);
      const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
      mocks.db.insert.mockReturnValue({ values: insertValues });

      const updateWhere = vi.fn().mockResolvedValue(undefined);
      const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
      mocks.db.update.mockReturnValue({ set: updateSet });

      // Temporarily override the handler to throw
      const originalHandler = BUILTIN_COMMANDS['cache.clear'].handler;
      BUILTIN_COMMANDS['cache.clear'].handler = async () => {
        throw new Error('Clear failed');
      };

      try {
        const result = await executeCommand(
          { command: 'cache.clear', parameters: {} },
          'test-signature',
        );

        expect(result.status).toBe('failed');
        expect(result.errorMessage).toContain('Clear failed');
      } finally {
        BUILTIN_COMMANDS['cache.clear'].handler = originalHandler;
      }
    });

    it('executes write command with parameters', async () => {
      const insertReturning = vi.fn().mockResolvedValue([{ id: 4, commandName: 'notification.send', status: 'received' }]);
      const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
      mocks.db.insert.mockReturnValue({ values: insertValues });

      const updateWhere = vi.fn().mockResolvedValue(undefined);
      const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
      mocks.db.update.mockReturnValue({ set: updateSet });

      const result = await executeCommand(
        { command: 'notification.send', parameters: { message: 'テスト通知' }, threadId: 'thread-1', reason: 'test' },
        'test-signature',
      );

      expect(result.status).toBe('completed');
      expect(result.result).toEqual(expect.objectContaining({ sent: true, message: 'テスト通知' }));
    });

    it('executes admin command (maintenance.enable)', async () => {
      const insertReturning = vi.fn().mockResolvedValue([{ id: 5, commandName: 'maintenance.enable', status: 'received' }]);
      const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
      mocks.db.insert.mockReturnValue({ values: insertValues });

      const updateWhere = vi.fn().mockResolvedValue(undefined);
      const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
      mocks.db.update.mockReturnValue({ set: updateSet });

      const result = await executeCommand(
        { command: 'maintenance.enable', parameters: {} },
        'test-signature',
      );

      expect(result.status).toBe('completed');
      expect(result.result).toEqual({ maintenanceMode: true });

      // Clean up
      delete process.env.MAINTENANCE_MODE;
    });

    it('executes admin command (maintenance.disable)', async () => {
      process.env.MAINTENANCE_MODE = 'true';
      const insertReturning = vi.fn().mockResolvedValue([{ id: 6, commandName: 'maintenance.disable', status: 'received' }]);
      const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
      mocks.db.insert.mockReturnValue({ values: insertValues });

      const updateWhere = vi.fn().mockResolvedValue(undefined);
      const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
      mocks.db.update.mockReturnValue({ set: updateSet });

      const result = await executeCommand(
        { command: 'maintenance.disable', parameters: {} },
        'test-signature',
      );

      expect(result.status).toBe('completed');
      expect(result.result).toEqual({ maintenanceMode: false });
    });

    it('executes pharmacy.toggle command', async () => {
      const insertReturning = vi.fn().mockResolvedValue([{ id: 7, commandName: 'pharmacy.toggle', status: 'received' }]);
      const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
      mocks.db.insert.mockReturnValue({ values: insertValues });

      const selectLimit = vi.fn().mockResolvedValue([{ id: 1, isActive: false }]);
      const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
      const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
      mocks.db.select.mockReturnValue({ from: selectFrom });

      const updateWhere = vi.fn().mockResolvedValue(undefined);
      const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
      mocks.db.update.mockReturnValue({ set: updateSet });

      const result = await executeCommand(
        { command: 'pharmacy.toggle', parameters: { pharmacyId: 1 } },
        'test-signature',
      );

      expect(result.status).toBe('completed');
      expect(result.result).toEqual(expect.objectContaining({ pharmacyId: 1, action: 'toggled' }));
    });

    it('executes job.cancel command', async () => {
      const insertReturning = vi.fn().mockResolvedValue([{ id: 8, commandName: 'job.cancel', status: 'received' }]);
      const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
      mocks.db.insert.mockReturnValue({ values: insertValues });

      const updateWhere = vi.fn().mockResolvedValue(undefined);
      const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
      mocks.db.update.mockReturnValue({ set: updateSet });

      const result = await executeCommand(
        { command: 'job.cancel', parameters: { jobId: 42 } },
        'test-signature',
      );

      expect(result.status).toBe('completed');
      expect(result.result).toEqual(expect.objectContaining({ jobId: 42, action: 'cancel_requested' }));
    });

    it('executes drug_master.sync command', async () => {
      const insertReturning = vi.fn().mockResolvedValue([{ id: 9, commandName: 'drug_master.sync', status: 'received' }]);
      const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
      mocks.db.insert.mockReturnValue({ values: insertValues });

      const updateWhere = vi.fn().mockResolvedValue(undefined);
      const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
      mocks.db.update.mockReturnValue({ set: updateSet });

      const result = await executeCommand(
        { command: 'drug_master.sync', parameters: {} },
        'test-signature',
      );

      expect(result.status).toBe('completed');
      expect(result.result).toEqual(expect.objectContaining({ syncTriggered: true }));
    });

    it('executes scheduler.restart command', async () => {
      const insertReturning = vi.fn().mockResolvedValue([{ id: 10, commandName: 'scheduler.restart', status: 'received' }]);
      const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
      mocks.db.insert.mockReturnValue({ values: insertValues });

      const updateWhere = vi.fn().mockResolvedValue(undefined);
      const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
      mocks.db.update.mockReturnValue({ set: updateSet });

      const result = await executeCommand(
        { command: 'scheduler.restart', parameters: {} },
        'test-signature',
      );

      expect(result.status).toBe('completed');
      expect(result.result).toEqual(expect.objectContaining({ restarted: true }));
    });
  });

  describe('listCommandHistory', () => {
    it('fetches command history with defaults', async () => {
      const offsetMock = vi.fn().mockResolvedValue([
        { id: 1, commandName: 'system.status', status: 'completed' },
      ]);
      const limitMock = vi.fn().mockReturnValue({ offset: offsetMock });
      const orderByMock = vi.fn().mockReturnValue({ limit: limitMock });
      const fromMock = vi.fn().mockReturnValue({ orderBy: orderByMock });
      mocks.db.select.mockReturnValue({ from: fromMock });

      const result = await listCommandHistory();

      expect(result).toHaveLength(1);
      expect(limitMock).toHaveBeenCalledWith(50);
      expect(offsetMock).toHaveBeenCalledWith(0);
    });

    it('limits to max 200', async () => {
      const offsetMock = vi.fn().mockResolvedValue([]);
      const limitMock = vi.fn().mockReturnValue({ offset: offsetMock });
      const orderByMock = vi.fn().mockReturnValue({ limit: limitMock });
      const fromMock = vi.fn().mockReturnValue({ orderBy: orderByMock });
      mocks.db.select.mockReturnValue({ from: fromMock });

      await listCommandHistory(500, 10);

      expect(limitMock).toHaveBeenCalledWith(200);
      expect(offsetMock).toHaveBeenCalledWith(10);
    });
  });
});
