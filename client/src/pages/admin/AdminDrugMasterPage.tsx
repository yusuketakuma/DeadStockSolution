import { useState, useEffect, useRef, useCallback, type MutableRefObject } from 'react';
import AppAlert from '../../components/ui/AppAlert';
import { useToast } from '../../contexts/ToastContext';
import { Col, Row } from 'react-bootstrap';
import { useSearchParams } from 'react-router-dom';
import { api, apiUpload } from '../../api/client';
import Pagination from '../../components/Pagination';
import SearchChips from '../../components/search/SearchChips';
import SearchResultStatus from '../../components/search/SearchResultStatus';
import { useIncrementalSearch } from '../../hooks/useIncrementalSearch';
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

function resolveErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function buildDrugMasterListParams(input: {
  page: number;
  search: string;
  statusFilter: string;
  categoryFilter: string;
}): string {
  const params = new URLSearchParams({
    page: String(input.page),
    limit: '100',
  });
  if (input.search) params.set('search', input.search);
  if (input.statusFilter) params.set('status', input.statusFilter);
  if (input.categoryFilter) params.set('category', input.categoryFilter);
  return params.toString();
}

function scheduleRefresh(
  timerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>,
  callback: () => void,
): void {
  if (timerRef.current !== null) {
    clearTimeout(timerRef.current);
  }
  timerRef.current = setTimeout(() => {
    timerRef.current = null;
    callback();
  }, 5000);
}

function fetchDrugMasterDetailByYjCode(yjCode: string): Promise<DrugMasterDetail> {
  return api.get<DrugMasterDetail>(`/admin/drug-master/detail/${encodeURIComponent(yjCode)}`);
}

// ── メインコンポーネント ─────────────────────────────

export default function AdminDrugMasterPage() {
  const { showError } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [stats, setStats] = useState<Stats | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

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

  // ── インクリメンタルサーチ ────────────────────────────
  const initialQuery = searchParams.get('search') || '';

  // statusFilter/categoryFilter を ref で保持（fetchFn 再生成を避ける）
  const statusFilterRef = useRef(statusFilter);
  statusFilterRef.current = statusFilter;
  const categoryFilterRef = useRef(categoryFilter);
  categoryFilterRef.current = categoryFilter;

  const [totalPages, setTotalPages] = useState(1);

  const fetchDrugMasterItems = useCallback(
    async (query: string, page: number, signal: AbortSignal) => {
      const params = buildDrugMasterListParams({
        page,
        search: query,
        statusFilter: statusFilterRef.current,
        categoryFilter: categoryFilterRef.current,
      });
      const data = await api.get<ListResponse>(`/admin/drug-master?${params}`, { signal });
      setTotalPages(data.pagination.totalPages);
      return { data: data.data, total: data.pagination.total };
    },
    [],
  );

  const incrementalSearch = useIncrementalSearch<DrugMasterItem>({
    fetchFn: fetchDrugMasterItems,
    minChars: 0,
    initialQuery,
  });

  // URL同期
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (incrementalSearch.query) {
      params.set('search', incrementalSearch.query);
    } else {
      params.delete('search');
    }
    setSearchParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incrementalSearch.query]);

  // 初回フェッチ
  useEffect(() => {
    incrementalSearch.executeImmediate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // フィルタ変更時は即座に再フェッチ
  useEffect(() => {
    incrementalSearch.executeImmediate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, categoryFilter]);

  const items = incrementalSearch.results;
  const total = incrementalSearch.total;
  const loading = incrementalSearch.isSearching;

  // ── データ取得 ──────────────────────────────────

  const fetchStats = useCallback(async () => {
    try {
      const data = await api.get<Stats>('/admin/drug-master/stats');
      setStats(data);
    } catch (_err) { showError('医薬品統計の取得に失敗しました'); }
  }, [showError]);

  const fetchSyncLogs = useCallback(async () => {
    try {
      const data = await api.get<{ data: SyncLog[] }>('/admin/drug-master/sync-logs');
      setSyncLogs(data.data.slice(0, 5));
    } catch { /* ignore */ }
  }, []);

  const fetchAutoSyncStatus = useCallback(async () => {
    try {
      const data = await api.get<AutoSyncStatus>('/admin/drug-master/auto-sync/status');
      setAutoSyncStatus(data);
    } catch { /* ignore */ }
  }, []);

  const fetchPackageAutoSyncStatus = useCallback(async () => {
    try {
      const data = await api.get<AutoSyncStatus>('/admin/drug-master/auto-sync/packages/status');
      setPackageAutoSyncStatus(data);
    } catch { /* ignore */ }
  }, []);

  const handleAutoSyncTrigger = async () => {
    setAutoSyncTriggering(true);
    try {
      const result = await api.post<{ triggered: boolean; message: string }>('/admin/drug-master/auto-sync', {
        sourceUrl: manualSourceUrl.trim() || null,
      });
      if (result.triggered) {
        setMessage(result.message);
        scheduleRefresh(autoSyncRefreshTimerRef, () => {
          fetchSyncLogs();
          fetchStats();
        });
      } else {
        setSyncError(result.message);
      }
    } catch (err) {
      setSyncError(resolveErrorMessage(err, '自動取得の開始に失敗しました'));
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
        scheduleRefresh(packageAutoSyncRefreshTimerRef, () => {
          fetchSyncLogs();
        });
      } else {
        setSyncError(result.message);
      }
    } catch (err) {
      setSyncError(resolveErrorMessage(err, '包装単位データ自動取得の開始に失敗しました'));
    } finally {
      setPackageAutoSyncTriggering(false);
    }
  };

  useEffect(() => {
    void fetchStats();
    void fetchSyncLogs();
    void fetchAutoSyncStatus();
    void fetchPackageAutoSyncStatus();
  }, [fetchAutoSyncStatus, fetchPackageAutoSyncStatus, fetchStats, fetchSyncLogs]);

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

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    incrementalSearch.executeImmediate();
  };

  const handleRemoveToken = (token: string) => {
    const newTokens = incrementalSearch.tokens.filter((t) => t !== token);
    incrementalSearch.setQuery(newTokens.join(' '));
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
      void fetchStats();
      incrementalSearch.executeImmediate();
      void fetchSyncLogs();
    } catch (err) {
      setSyncError(resolveErrorMessage(err, '同期に失敗しました'));
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
      setError(resolveErrorMessage(err, '登録に失敗しました'));
    } finally {
      setPkgUploading(false);
    }
  };

  // ── 詳細表示 ────────────────────────────────────

  const openDetail = async (yjCode: string) => {
    try {
      const data = await fetchDrugMasterDetailByYjCode(yjCode);
      setDetail(data);
      setShowDetail(true);
    } catch (err) {
      setError(resolveErrorMessage(err, '詳細の取得に失敗しました'));
    }
  };

  // ── 編集 ───────────────────────────────────────

  const openEdit = async (yjCode: string) => {
    try {
      const data = await fetchDrugMasterDetailByYjCode(yjCode);
      setEditItem(data);
      setShowEdit(true);
    } catch (err) {
      setError(resolveErrorMessage(err, '詳細の取得に失敗しました'));
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
      incrementalSearch.executeImmediate();
      void fetchStats();
    } catch (err) {
      setError(resolveErrorMessage(err, '更新に失敗しました'));
    } finally {
      setEditSaving(false);
    }
  };

  // ── レンダリング ──────────────────────────────────

  const resultsStyle = {
    opacity: incrementalSearch.isSearching ? 0.6 : 1,
    transition: 'opacity 0.2s',
  };

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
        searchInput={incrementalSearch.query}
        statusFilter={statusFilter}
        categoryFilter={categoryFilter}
        total={total}
        loading={loading}
        onSearchInputChange={incrementalSearch.setQuery}
        onSearch={handleSearch}
        onStatusFilterChange={(v) => { setStatusFilter(v); }}
        onCategoryFilterChange={(v) => { setCategoryFilter(v); }}
      />

      <div className="mb-2">
        <SearchChips
          tokens={incrementalSearch.tokens}
          onRemove={handleRemoveToken}
          maxTokenWarning={incrementalSearch.tokens.length > 5}
        />
      </div>

      <div className="mb-2">
        <SearchResultStatus
          totalCount={total}
          isSearching={incrementalSearch.isSearching}
          searchQuery={incrementalSearch.query}
        />
      </div>

      <ScrollArea>
      <div style={resultsStyle}>
      <DrugMasterTable
        items={items}
        loading={loading}
        totalItems={stats?.totalItems}
        onOpenDetail={openDetail}
        onOpenEdit={openEdit}
      />
      <Pagination currentPage={incrementalSearch.page} totalPages={totalPages} onPageChange={incrementalSearch.setPage} />
      </div>
      </ScrollArea>

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
