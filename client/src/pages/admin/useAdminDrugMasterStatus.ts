import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';

interface Stats {
  totalItems: number;
  listedItems: number;
  transitionItems: number;
  delistedItems: number;
  lastSyncAt: string | null;
}

interface SyncLog {
  id: number;
  syncType: string;
  sourceDescription: string | null;
  status: string;
  itemsProcessed: number;
  itemsAdded: number;
  itemsUpdated: number;
  itemsDeleted: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface AutoSyncStatus {
  enabled: boolean;
  sourceHost: string;
  hasSourceUrl: boolean;
  checkIntervalHours: number;
  supportsManualUrlOverride: boolean;
  sourceMode?: 'index' | 'single';
}

interface MasterRefreshResponse {
  triggered: boolean;
  message: string;
  steps: Array<{
    key: 'drug-master' | 'package-master';
    label: string;
    triggered: boolean;
    message: string;
  }>;
}

export interface MasterRefreshStep {
  key: 'drug-master' | 'package-master';
  label: string;
  status: 'idle' | 'running' | 'success' | 'failed';
  sourceDescription: string | null;
  message: string;
  startedAt: string | null;
  completedAt: string | null;
}

function resolveErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function summarizeLogMessage(log: SyncLog | undefined): string {
  if (!log) return '未実行です';
  if (log.status === 'running') return '更新処理を実行しています';
  if (log.status === 'failed') return log.errorMessage || '更新に失敗しました';
  return `処理 ${log.itemsProcessed}件 / 追加 ${log.itemsAdded}件 / 更新 ${log.itemsUpdated}件 / 削除 ${log.itemsDeleted}件`;
}

function getLatestLogByType(syncLogs: SyncLog[], syncTypes: string[]): SyncLog | undefined {
  return syncLogs.find((log) => syncTypes.includes(log.syncType));
}

function buildMasterRefreshSteps(syncLogs: SyncLog[]): MasterRefreshStep[] {
  const drugMasterLog = getLatestLogByType(syncLogs, ['auto']);
  const packageLog = getLatestLogByType(syncLogs, ['package_auto']);

  return [
    {
      key: 'drug-master',
      label: '医薬品マスター本体',
      status: (drugMasterLog?.status as MasterRefreshStep['status'] | undefined) ?? 'idle',
      sourceDescription: drugMasterLog?.sourceDescription ?? null,
      message: summarizeLogMessage(drugMasterLog),
      startedAt: drugMasterLog?.startedAt ?? null,
      completedAt: drugMasterLog?.completedAt ?? null,
    },
    {
      key: 'package-master',
      label: '包装単位データ',
      status: (packageLog?.status as MasterRefreshStep['status'] | undefined) ?? 'idle',
      sourceDescription: packageLog?.sourceDescription ?? null,
      message: summarizeLogMessage(packageLog),
      startedAt: packageLog?.startedAt ?? null,
      completedAt: packageLog?.completedAt ?? null,
    },
  ];
}

export function useAdminDrugMasterStatus(showError: (message: string) => void) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [autoSyncStatus, setAutoSyncStatus] = useState<AutoSyncStatus | null>(null);
  const [packageAutoSyncStatus, setPackageAutoSyncStatus] = useState<AutoSyncStatus | null>(null);
  const [masterRefreshRunning, setMasterRefreshRunning] = useState(false);
  const [masterRefreshPolling, setMasterRefreshPolling] = useState(false);
  const [masterRefreshMessage, setMasterRefreshMessage] = useState('');
  const [masterRefreshError, setMasterRefreshError] = useState('');

  const refreshStats = useCallback(async () => {
    try {
      const data = await api.get<Stats>('/admin/drug-master/stats');
      setStats(data);
    } catch {
      showError('医薬品統計の取得に失敗しました');
    }
  }, [showError]);

  const refreshSyncLogs = useCallback(async () => {
    try {
      const data = await api.get<{ data: SyncLog[] }>('/admin/drug-master/sync-logs');
      setSyncLogs(data.data.slice(0, 10));
    } catch {
      // ignore
    }
  }, []);

  const refreshAutoSyncStatus = useCallback(async () => {
    try {
      const data = await api.get<AutoSyncStatus>('/admin/drug-master/auto-sync/status');
      setAutoSyncStatus(data);
    } catch {
      // ignore
    }
  }, []);

  const refreshPackageAutoSyncStatus = useCallback(async () => {
    try {
      const data = await api.get<AutoSyncStatus>('/admin/drug-master/auto-sync/packages/status');
      setPackageAutoSyncStatus(data);
    } catch {
      // ignore
    }
  }, []);

  const refreshAll = useCallback(() => {
    void refreshStats();
    void refreshSyncLogs();
    void refreshAutoSyncStatus();
    void refreshPackageAutoSyncStatus();
  }, [refreshAutoSyncStatus, refreshPackageAutoSyncStatus, refreshStats, refreshSyncLogs]);

  const masterRefreshSteps = useMemo(() => buildMasterRefreshSteps(syncLogs), [syncLogs]);
  const masterRefreshActive = masterRefreshSteps.some((step) => step.status === 'running');

  const handleMasterRefresh = useCallback(async () => {
    setMasterRefreshRunning(true);
    setMasterRefreshMessage('');
    setMasterRefreshError('');
    try {
      const result = await api.post<MasterRefreshResponse>('/admin/drug-master/master-refresh', {});
      if (result.triggered) {
        setMasterRefreshMessage(result.message);
        setMasterRefreshPolling(true);
        refreshAll();
      } else {
        setMasterRefreshError(result.message);
      }
    } catch (err) {
      setMasterRefreshError(resolveErrorMessage(err, 'マスター更新の開始に失敗しました'));
    } finally {
      setMasterRefreshRunning(false);
    }
  }, [refreshAll]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!masterRefreshPolling && !masterRefreshActive) return undefined;

    const intervalId = setInterval(() => {
      refreshAll();
    }, 2000);

    return () => clearInterval(intervalId);
  }, [masterRefreshActive, masterRefreshPolling, refreshAll]);

  useEffect(() => {
    if (!masterRefreshPolling) return;
    if (masterRefreshActive) return;
    if (!masterRefreshSteps.some((step) => step.status !== 'idle')) return;
    setMasterRefreshPolling(false);
  }, [masterRefreshActive, masterRefreshPolling, masterRefreshSteps]);

  return {
    stats,
    syncLogs,
    autoSyncStatus,
    packageAutoSyncStatus,
    masterRefreshRunning,
    masterRefreshPolling,
    masterRefreshMessage,
    masterRefreshError,
    masterRefreshSteps,
    masterRefreshActive,
    handleMasterRefresh,
    refreshStats,
    refreshSyncLogs,
  };
}
