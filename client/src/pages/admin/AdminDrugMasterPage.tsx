import { useState, useEffect, useRef, useCallback } from 'react';
import AppAlert from '../../components/ui/AppAlert';
import { useToast } from '../../contexts/ToastContext';
import { Badge, Col, Form, Row } from 'react-bootstrap';
import { Link, useSearchParams } from 'react-router-dom';
import AppButton from '../../components/ui/AppButton';
import MobileFilterSheet from '../../components/mobile/MobileFilterSheet';
import { api, apiUpload } from '../../api/client';
import Pagination from '../../components/Pagination';
import SearchChips from '../../components/search/SearchChips';
import SearchResultStatus from '../../components/search/SearchResultStatus';
import { useIncrementalSearch } from '../../hooks/useIncrementalSearch';
import DrugMasterSyncCard from './components/DrugMasterSyncCard';
import PackageUploadCard from './components/PackageUploadCard';
import MasterRefreshCard from './components/MasterRefreshCard';
import SyncLogsTable from './components/SyncLogsTable';
import DrugMasterStatsCards from './components/DrugMasterStatsCards';
import SearchInput from '../../components/SearchInput';
import AppSelect from '../../components/ui/AppSelect';
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
  sourceMode?: 'index' | 'single';
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

function fetchDrugMasterDetailByYjCode(yjCode: string): Promise<DrugMasterDetail> {
  return api.get<DrugMasterDetail>(`/admin/drug-master/detail/${encodeURIComponent(yjCode)}`);
}

type MasterRefreshStep = {
  key: 'drug-master' | 'package-master';
  label: string;
  status: 'idle' | 'running' | 'success' | 'failed';
  sourceDescription: string | null;
  message: string;
  startedAt: string | null;
  completedAt: string | null;
};

type MasterRefreshResponse = {
  triggered: boolean;
  message: string;
  steps: Array<{
    key: 'drug-master' | 'package-master';
    label: string;
    triggered: boolean;
    message: string;
  }>;
};

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
  const [showManualMaintenance, setShowManualMaintenance] = useState(false);

  // 自動取得関連
  const [autoSyncStatus, setAutoSyncStatus] = useState<AutoSyncStatus | null>(null);
  const [packageAutoSyncStatus, setPackageAutoSyncStatus] = useState<AutoSyncStatus | null>(null);
  const [packageMessage, setPackageMessage] = useState('');
  const [packageError, setPackageError] = useState('');
  const [masterRefreshRunning, setMasterRefreshRunning] = useState(false);
  const [masterRefreshPolling, setMasterRefreshPolling] = useState(false);
  const [masterRefreshMessage, setMasterRefreshMessage] = useState('');
  const [masterRefreshError, setMasterRefreshError] = useState('');

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
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

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
  const masterRefreshSteps = buildMasterRefreshSteps(syncLogs);
  const masterRefreshActive = masterRefreshSteps.some((step) => step.status === 'running');

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
      setSyncLogs(data.data.slice(0, 10));
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

  const handleMasterRefresh = async () => {
    setMasterRefreshRunning(true);
    setMasterRefreshMessage('');
    setMasterRefreshError('');
    try {
      const result = await api.post<MasterRefreshResponse>('/admin/drug-master/master-refresh', {});
      if (result.triggered) {
        setMasterRefreshMessage(result.message);
        setMasterRefreshPolling(true);
        void fetchSyncLogs();
        void fetchStats();
        void fetchAutoSyncStatus();
        void fetchPackageAutoSyncStatus();
      } else {
        setMasterRefreshError(result.message);
      }
    } catch (err) {
      setMasterRefreshError(resolveErrorMessage(err, 'マスター更新の開始に失敗しました'));
    } finally {
      setMasterRefreshRunning(false);
    }
  };

  useEffect(() => {
    void fetchStats();
    void fetchSyncLogs();
    void fetchAutoSyncStatus();
    void fetchPackageAutoSyncStatus();
  }, [fetchAutoSyncStatus, fetchPackageAutoSyncStatus, fetchStats, fetchSyncLogs]);

  useEffect(() => {
    if (!masterRefreshPolling && !masterRefreshActive) return undefined;

    const intervalId = setInterval(() => {
      void fetchSyncLogs();
      void fetchStats();
      void fetchAutoSyncStatus();
      void fetchPackageAutoSyncStatus();
    }, 2000);

    return () => clearInterval(intervalId);
  }, [
    fetchAutoSyncStatus,
    fetchPackageAutoSyncStatus,
    fetchStats,
    fetchSyncLogs,
    masterRefreshActive,
    masterRefreshPolling,
  ]);

  useEffect(() => {
    if (!masterRefreshPolling) return;
    if (masterRefreshActive) return;
    if (!masterRefreshSteps.some((step) => step.status !== 'idle')) return;
    setMasterRefreshPolling(false);
  }, [masterRefreshActive, masterRefreshPolling, masterRefreshSteps]);

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
      setPackageError('ファイルを選択してください');
      return;
    }

    setPkgUploading(true);
    setPackageMessage('');
    setPackageError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const result = await apiUpload<{ message: string; result: { added: number; updated: number } }>(
        '/admin/drug-master/upload-packages', formData,
      );
      setPackageMessage(`包装単位登録完了: 追加 ${result.result.added}件 / 更新 ${result.result.updated}件`);
      if (pkgFileRef.current) pkgFileRef.current.value = '';
      void fetchSyncLogs();
    } catch (err) {
      setPackageError(resolveErrorMessage(err, '登録に失敗しました'));
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

  const searchInputProps = {
    placeholder: '品名・成分名・メーカー・YJコードで検索',
    value: incrementalSearch.query,
    onChange: incrementalSearch.setQuery,
    onSearch: () => incrementalSearch.executeImmediate(),
    suggestUrl: '/search/drug-master-names',
  } as const;

  const resultsStyle = {
    opacity: incrementalSearch.isSearching ? 0.6 : 1,
    transition: 'opacity 0.2s',
  };

  return (
    <PageShell>
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">医薬品マスター管理</h4>
          <div className="text-muted small">更新状況の追跡、絞り込み、手動メンテナンスを device 幅に合わせて配置します。</div>
        </div>
        <div className="dl-page-header-actions d-flex gap-2 flex-wrap">
          <Link to="/admin/drug-equivalences" className="btn btn-outline-secondary btn-sm">薬品同等性</Link>
          <Link to="/admin/matching-rules" className="btn btn-outline-secondary btn-sm">マッチングルール</Link>
        </div>
      </div>

      <ScrollArea>
      {message && <AppAlert variant="success" onClose={() => setMessage('')} dismissible>{message}</AppAlert>}
      {error && <AppAlert variant="danger" onClose={() => setError('')} dismissible>{error}</AppAlert>}

      <DrugMasterStatsCards stats={stats} />

      <MasterRefreshCard
        refreshing={masterRefreshRunning}
        active={masterRefreshActive || masterRefreshPolling}
        message={masterRefreshMessage}
        error={masterRefreshError}
        autoSyncStatus={autoSyncStatus}
        packageAutoSyncStatus={packageAutoSyncStatus}
        steps={masterRefreshSteps}
        onRefresh={handleMasterRefresh}
      />

      <SyncLogsTable syncLogs={syncLogs} />

      <details className="mb-3" open={showManualMaintenance} onToggle={(e) => {
        setShowManualMaintenance((e.currentTarget as HTMLDetailsElement).open);
      }}>
        <summary className="small fw-semibold mb-3" style={{ cursor: 'pointer', listStyle: 'none' }}>
          手動メンテナンス
        </summary>
        {showManualMaintenance && (
          <>
            <p className="small text-muted mb-3">
              緊急時のみ、個別ファイルの手動取込を実行できます。
            </p>
            <Row className="g-3 mb-3">
              <Col xl={6}>
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
              <Col xl={6}>
                <PackageUploadCard
                  pkgFileRef={pkgFileRef}
                  pkgUploading={pkgUploading}
                  packageMessage={packageMessage}
                  packageError={packageError}
                  onPackageUpload={handlePackageUpload}
                />
              </Col>
            </Row>
          </>
        )}
      </details>

      {/* 検索・フィルタ（デスクトップ） */}
      <div className="d-none d-xl-block mb-3">
        <Row className="g-2 align-items-end">
          <Col md={5}>
            <SearchInput {...searchInputProps} />
          </Col>
          <Col md={3}>
            <AppSelect
              size="sm"
              value={statusFilter}
              ariaLabel="ステータスで絞り込み"
              onChange={(v) => { setStatusFilter(v); }}
              options={[
                { value: '', label: '全ステータス' },
                { value: 'listed', label: '収載中' },
                { value: 'transition', label: '経過措置中' },
                { value: 'delisted', label: '削除済' },
              ]}
            />
          </Col>
          <Col md={3}>
            <AppSelect
              size="sm"
              value={categoryFilter}
              ariaLabel="区分で絞り込み"
              onChange={(v) => { setCategoryFilter(v); }}
              options={[
                { value: '', label: '全区分' },
                { value: '内用薬', label: '内用薬' },
                { value: '外用薬', label: '外用薬' },
                { value: '注射薬', label: '注射薬' },
                { value: '歯科用薬剤', label: '歯科用薬剤' },
              ]}
            />
          </Col>
          <Col md={1} className="text-end">
            <span className="small text-muted">{total.toLocaleString()}件</span>
          </Col>
        </Row>
      </div>

      {/* 検索・フィルタ（モバイル） */}
      <div className="d-xl-none mb-2">
        <div className="mb-2">
          <SearchInput {...searchInputProps} />
        </div>
        <div className="d-flex align-items-center gap-2">
          <AppButton
            size="sm"
            variant="outline-secondary"
            onClick={() => setFilterSheetOpen(true)}
          >
            <i className="bi bi-funnel" />{' '}
            フィルタ
            {(statusFilter || categoryFilter) && (
              <Badge bg="primary" pill className="ms-1">
                {(statusFilter ? 1 : 0) + (categoryFilter ? 1 : 0)}
              </Badge>
            )}
          </AppButton>
        </div>
      </div>
      <MobileFilterSheet
        isOpen={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        title="絞り込み"
        activeFilterCount={(statusFilter ? 1 : 0) + (categoryFilter ? 1 : 0)}
        onReset={() => {
          setStatusFilter('');
          setCategoryFilter('');
        }}
        onApply={() => {/* filters already applied via state */}}
      >
        <Form.Group className="mb-3">
          <Form.Label className="fw-semibold small">ステータス</Form.Label>
          {[
            { value: '', label: '全ステータス' },
            { value: 'listed', label: '収載中' },
            { value: 'transition', label: '経過措置中' },
            { value: 'delisted', label: '削除済' },
          ].map((opt) => (
            <Form.Check
              key={opt.value}
              type="radio"
              id={`status-filter-${opt.value || 'all'}`}
              name="statusFilter"
              label={opt.label}
              checked={statusFilter === opt.value}
              onChange={() => setStatusFilter(opt.value)}
            />
          ))}
        </Form.Group>
        <Form.Group>
          <Form.Label className="fw-semibold small">区分</Form.Label>
          {[
            { value: '', label: '全区分' },
            { value: '内用薬', label: '内用薬' },
            { value: '外用薬', label: '外用薬' },
            { value: '注射薬', label: '注射薬' },
            { value: '歯科用薬剤', label: '歯科用薬剤' },
          ].map((opt) => (
            <Form.Check
              key={opt.value}
              type="radio"
              id={`category-filter-${opt.value || 'all'}`}
              name="categoryFilter"
              label={opt.label}
              checked={categoryFilter === opt.value}
              onChange={() => setCategoryFilter(opt.value)}
            />
          ))}
        </Form.Group>
      </MobileFilterSheet>

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
