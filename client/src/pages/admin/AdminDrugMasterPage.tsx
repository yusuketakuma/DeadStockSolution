import { useState, useEffect, useRef, FormEvent, useCallback } from 'react';
import AppAlert from '../../components/ui/AppAlert';
import { useToast } from '../../contexts/ToastContext';
import { Col, Row } from 'react-bootstrap';
import { api, apiUpload } from '../../api/client';
import Pagination from '../../components/Pagination';
import DrugMasterSyncCard from './components/DrugMasterSyncCard';
import PackageUploadCard from './components/PackageUploadCard';
import AutoSyncStatusCard from './components/AutoSyncStatusCard';
import SyncLogsTable from './components/SyncLogsTable';
import DrugMasterStatsCards from './components/DrugMasterStatsCards';
import DrugMasterSearchFilter from './components/DrugMasterSearchFilter';
import DrugMasterTable from './components/DrugMasterTable';
import DrugMasterDetailModal from './components/DrugMasterDetailModal';
import DrugMasterEditModal from './components/DrugMasterEditModal';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';

import type { DrugMasterItem, DrugMasterDetail } from './components/types';

// ── 型定義 ──────────────────────────────────────

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

interface ListResponse {
  data: DrugMasterItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface AutoSyncStatus {
  enabled: boolean;
  sourceHost: string;
  hasSourceUrl: boolean;
  checkIntervalHours: number;
  supportsManualUrlOverride: boolean;
}

// ── メインコンポーネント ─────────────────────────────

export default function AdminDrugMasterPage() {
  const { showError } = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [items, setItems] = useState<DrugMasterItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [loading, setLoading] = useState(false);

  // 同期関連
  const [syncing, setSyncing] = useState(false);
  const [pkgUploading, setPkgUploading] = useState(false);
  const [syncResult, setSyncResult] = useState('');
  const [syncError, setSyncError] = useState('');
  const [revisionDate, setRevisionDate] = useState(new Date().toISOString().slice(0, 10));
  const syncFileRef = useRef<HTMLInputElement>(null);
  const pkgFileRef = useRef<HTMLInputElement>(null);

  // 自動取得関連
  const [autoSyncStatus, setAutoSyncStatus] = useState<AutoSyncStatus | null>(null);
  const [autoSyncTriggering, setAutoSyncTriggering] = useState(false);
  const [manualSourceUrl, setManualSourceUrl] = useState('');
  const [packageAutoSyncStatus, setPackageAutoSyncStatus] = useState<AutoSyncStatus | null>(null);
  const [packageAutoSyncTriggering, setPackageAutoSyncTriggering] = useState(false);
  const [packageManualSourceUrl, setPackageManualSourceUrl] = useState('');
  const autoSyncRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const packageAutoSyncRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 同期ログ
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);

  // 詳細モーダル
  const [detail, setDetail] = useState<DrugMasterDetail | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  // 編集モーダル
  const [editItem, setEditItem] = useState<DrugMasterDetail | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // ── データ取得 ──────────────────────────────────

  const fetchStats = useCallback(async () => {
    try {
      const data = await api.get<Stats>('/admin/drug-master/stats');
      setStats(data);
    } catch (_err) { showError('医薬品統計の取得に失敗しました'); }
  }, [showError]);

  const fetchItems = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: '30' });
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      if (categoryFilter) params.set('category', categoryFilter);

      const data = await api.get<ListResponse>(`/admin/drug-master?${params}`);
      setItems(data.data);
      setTotalPages(data.pagination.totalPages);
      setTotal(data.pagination.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'データの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, categoryFilter]);

  const fetchSyncLogs = async () => {
    try {
      const data = await api.get<{ data: SyncLog[] }>('/admin/drug-master/sync-logs');
      setSyncLogs(data.data.slice(0, 5));
    } catch { /* ignore */ }
  };

  const fetchAutoSyncStatus = async () => {
    try {
      const data = await api.get<AutoSyncStatus>('/admin/drug-master/auto-sync/status');
      setAutoSyncStatus(data);
    } catch { /* ignore */ }
  };

  const fetchPackageAutoSyncStatus = async () => {
    try {
      const data = await api.get<AutoSyncStatus>('/admin/drug-master/auto-sync/packages/status');
      setPackageAutoSyncStatus(data);
    } catch { /* ignore */ }
  };

  const handleAutoSyncTrigger = async () => {
    setAutoSyncTriggering(true);
    try {
      const result = await api.post<{ triggered: boolean; message: string }>('/admin/drug-master/auto-sync', {
        sourceUrl: manualSourceUrl.trim() || null,
      });
      if (result.triggered) {
        setMessage(result.message);
        if (autoSyncRefreshTimerRef.current !== null) {
          clearTimeout(autoSyncRefreshTimerRef.current);
        }
        autoSyncRefreshTimerRef.current = setTimeout(() => {
          autoSyncRefreshTimerRef.current = null;
          fetchSyncLogs();
          fetchStats();
        }, 5000);
      } else {
        setSyncError(result.message);
      }
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : '自動取得の開始に失敗しました');
    } finally {
      setAutoSyncTriggering(false);
    }
  };

  const handlePackageAutoSyncTrigger = async () => {
    setPackageAutoSyncTriggering(true);
    try {
      const result = await api.post<{ triggered: boolean; message: string }>('/admin/drug-master/auto-sync/packages', {
        sourceUrl: packageManualSourceUrl.trim() || null,
      });
      if (result.triggered) {
        setMessage(result.message);
        if (packageAutoSyncRefreshTimerRef.current !== null) {
          clearTimeout(packageAutoSyncRefreshTimerRef.current);
        }
        packageAutoSyncRefreshTimerRef.current = setTimeout(() => {
          packageAutoSyncRefreshTimerRef.current = null;
          fetchSyncLogs();
        }, 5000);
      } else {
        setSyncError(result.message);
      }
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : '包装単位データ自動取得の開始に失敗しました');
    } finally {
      setPackageAutoSyncTriggering(false);
    }
  };

  useEffect(() => {
    fetchStats();
    fetchSyncLogs();
    fetchAutoSyncStatus();
    fetchPackageAutoSyncStatus();
  }, [fetchStats]);

  useEffect(() => () => {
    if (autoSyncRefreshTimerRef.current !== null) {
      clearTimeout(autoSyncRefreshTimerRef.current);
      autoSyncRefreshTimerRef.current = null;
    }
    if (packageAutoSyncRefreshTimerRef.current !== null) {
      clearTimeout(packageAutoSyncRefreshTimerRef.current);
      packageAutoSyncRefreshTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    fetchItems(page);
  }, [page, fetchItems]);

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput);
  };

  // ── 同期処理 ────────────────────────────────────

  const handleSync = async () => {
    const file = syncFileRef.current?.files?.[0];
    if (!file) {
      setSyncError('ファイルを選択してください');
      return;
    }

    setSyncing(true);
    setSyncResult('');
    setSyncError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('revisionDate', revisionDate);

      const result = await apiUpload<{
        message: string;
        result: { itemsProcessed: number; itemsAdded: number; itemsUpdated: number; itemsDeleted: number };
      }>('/admin/drug-master/sync', formData);

      const r = result.result;
      setSyncResult(`同期完了: 処理 ${r.itemsProcessed}件 / 追加 ${r.itemsAdded}件 / 更新 ${r.itemsUpdated}件 / 削除 ${r.itemsDeleted}件`);
      if (syncFileRef.current) syncFileRef.current.value = '';
      fetchStats();
      fetchItems(page);
      fetchSyncLogs();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : '同期に失敗しました');
    } finally {
      setSyncing(false);
    }
  };

  const handlePackageUpload = async () => {
    const file = pkgFileRef.current?.files?.[0];
    if (!file) {
      setError('ファイルを選択してください');
      return;
    }

    setPkgUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const result = await apiUpload<{ message: string; result: { added: number; updated: number } }>(
        '/admin/drug-master/upload-packages', formData,
      );
      setMessage(`包装単位登録完了: 追加 ${result.result.added}件 / 更新 ${result.result.updated}件`);
      if (pkgFileRef.current) pkgFileRef.current.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : '登録に失敗しました');
    } finally {
      setPkgUploading(false);
    }
  };

  // ── 詳細表示 ────────────────────────────────────

  const openDetail = async (yjCode: string) => {
    try {
      const data = await api.get<DrugMasterDetail>(`/admin/drug-master/detail/${encodeURIComponent(yjCode)}`);
      setDetail(data);
      setShowDetail(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '詳細の取得に失敗しました');
    }
  };

  // ── 編集 ───────────────────────────────────────

  const openEdit = async (yjCode: string) => {
    try {
      const data = await api.get<DrugMasterDetail>(`/admin/drug-master/detail/${encodeURIComponent(yjCode)}`);
      setEditItem(data);
      setShowEdit(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '詳細の取得に失敗しました');
    }
  };

  const handleEditSave = async () => {
    if (!editItem) return;
    setEditSaving(true);
    try {
      await api.put(`/admin/drug-master/detail/${encodeURIComponent(editItem.yjCode)}`, {
        drugName: editItem.drugName,
        genericName: editItem.genericName,
        specification: editItem.specification,
        unit: editItem.unit,
        yakkaPrice: editItem.yakkaPrice,
        manufacturer: editItem.manufacturer,
        isListed: editItem.isListed,
        transitionDeadline: editItem.transitionDeadline,
      });
      setMessage('医薬品情報を更新しました');
      setShowEdit(false);
      fetchItems(page);
      fetchStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新に失敗しました');
    } finally {
      setEditSaving(false);
    }
  };

  // ── レンダリング ──────────────────────────────────

  return (
    <PageShell>
      <h4 className="page-title mb-3">医薬品マスター管理</h4>

      {message && <AppAlert variant="success" onClose={() => setMessage('')} dismissible>{message}</AppAlert>}
      {error && <AppAlert variant="danger" onClose={() => setError('')} dismissible>{error}</AppAlert>}

      <DrugMasterStatsCards stats={stats} />

      <Row className="g-3 mb-3">
        <Col lg={6}>
          <DrugMasterSyncCard
            revisionDate={revisionDate}
            onRevisionDateChange={setRevisionDate}
            syncFileRef={syncFileRef}
            syncing={syncing}
            syncResult={syncResult}
            syncError={syncError}
            onSync={handleSync}
          />
        </Col>
        <Col lg={6}>
          <PackageUploadCard
            pkgFileRef={pkgFileRef}
            pkgUploading={pkgUploading}
            packageAutoSyncStatus={packageAutoSyncStatus}
            packageAutoSyncTriggering={packageAutoSyncTriggering}
            packageManualSourceUrl={packageManualSourceUrl}
            onPackageManualSourceUrlChange={setPackageManualSourceUrl}
            onPackageUpload={handlePackageUpload}
            onPackageAutoSyncTrigger={handlePackageAutoSyncTrigger}
          />
        </Col>
      </Row>

      <AutoSyncStatusCard
        autoSyncStatus={autoSyncStatus}
        autoSyncTriggering={autoSyncTriggering}
        manualSourceUrl={manualSourceUrl}
        onManualSourceUrlChange={setManualSourceUrl}
        onAutoSyncTrigger={handleAutoSyncTrigger}
      />

      <SyncLogsTable syncLogs={syncLogs} />

      <DrugMasterSearchFilter
        searchInput={searchInput}
        statusFilter={statusFilter}
        categoryFilter={categoryFilter}
        total={total}
        onSearchInputChange={setSearchInput}
        onSearch={handleSearch}
        onStatusFilterChange={(v) => { setStatusFilter(v); setPage(1); }}
        onCategoryFilterChange={(v) => { setCategoryFilter(v); setPage(1); }}
      />

      <ScrollArea>
      <DrugMasterTable
        items={items}
        loading={loading}
        totalItems={stats?.totalItems}
        onOpenDetail={openDetail}
        onOpenEdit={openEdit}
      />
      </ScrollArea>
      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />

      <DrugMasterDetailModal
        detail={detail}
        show={showDetail}
        onHide={() => setShowDetail(false)}
      />

      <DrugMasterEditModal
        editItem={editItem}
        show={showEdit}
        editSaving={editSaving}
        onHide={() => setShowEdit(false)}
        onEditItemChange={setEditItem}
        onSave={handleEditSave}
      />
    </PageShell>
  );
}
