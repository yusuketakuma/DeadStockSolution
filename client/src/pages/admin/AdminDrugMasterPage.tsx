import { useState } from 'react';
import AppAlert from '../../components/ui/AppAlert';
import { useToast } from '../../contexts/ToastContext';
import { Badge, Col, Form, Row } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import AppButton from '../../components/ui/AppButton';
import MobileFilterSheet from '../../components/mobile/MobileFilterSheet';
import Pagination from '../../components/Pagination';
import SearchChips from '../../components/search/SearchChips';
import SearchResultStatus from '../../components/search/SearchResultStatus';
import AppDropdownMenu from '../../components/ui/AppDropdownMenu';
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
import {
  DRUG_MASTER_CATEGORY_OPTIONS,
  DRUG_MASTER_STATUS_OPTIONS,
  useAdminDrugMasterSearch,
} from './useAdminDrugMasterSearch';
import { useAdminDrugMasterDetailEditor } from './useAdminDrugMasterDetailEditor';
import { useAdminDrugMasterMaintenance } from './useAdminDrugMasterMaintenance';
import { useAdminDrugMasterStatus } from './useAdminDrugMasterStatus';

// ── メインコンポーネント ─────────────────────────────

export default function AdminDrugMasterPage() {
  const { showError } = useToast();

  const [showManualMaintenance, setShowManualMaintenance] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  const incrementalSearch = useAdminDrugMasterSearch();
  const {
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
  } = useAdminDrugMasterStatus(showError);
  const {
    syncing,
    pkgUploading,
    syncResult,
    syncError,
    revisionDate,
    setRevisionDate,
    syncFileRef,
    pkgFileRef,
    packageMessage,
    packageError,
    handleSync,
    handlePackageUpload,
  } = useAdminDrugMasterMaintenance({
    onSyncSuccess: () => {
      void refreshStats();
      incrementalSearch.executeImmediate();
      void refreshSyncLogs();
    },
    onPackageUploadSuccess: () => {
      void refreshSyncLogs();
    },
  });
  const {
    detail,
    showDetail,
    closeDetail,
    editItem,
    showEdit,
    closeEdit,
    setEditItem,
    editSaving,
    message,
    clearMessage,
    error,
    clearError,
    openDetail,
    openEdit,
    handleEditSave,
  } = useAdminDrugMasterDetailEditor({
    onSaveSuccess: () => {
      incrementalSearch.executeImmediate();
      void refreshStats();
    },
  });

  const items = incrementalSearch.results;
  const total = incrementalSearch.total;
  const loading = incrementalSearch.isSearching;
  const statusFilter = incrementalSearch.statusFilter;
  const categoryFilter = incrementalSearch.categoryFilter;

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
        <div className="dl-action-row mobile-stack">
          <Link to="/admin/drug-equivalences" className="btn btn-outline-primary btn-sm">薬品同等性</Link>
          <AppDropdownMenu
            label="関連"
            size="sm"
            variant="outline-secondary"
            items={[
              { label: 'マッチングルール', to: '/admin/matching-rules' },
              { label: 'アップロード品質', to: '/admin/upload-quality' },
            ]}
          />
        </div>
      </div>

      <ScrollArea>
      {message && <AppAlert variant="success" onClose={clearMessage} dismissible>{message}</AppAlert>}
      {error && <AppAlert variant="danger" onClose={clearError} dismissible>{error}</AppAlert>}

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
              onChange={incrementalSearch.setStatusFilter}
              options={DRUG_MASTER_STATUS_OPTIONS}
            />
          </Col>
          <Col md={3}>
            <AppSelect
              size="sm"
              value={categoryFilter}
              ariaLabel="区分で絞り込み"
              onChange={incrementalSearch.setCategoryFilter}
              options={DRUG_MASTER_CATEGORY_OPTIONS}
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
            {incrementalSearch.activeFilterCount > 0 && (
              <Badge bg="primary" pill className="ms-1">
                {incrementalSearch.activeFilterCount}
              </Badge>
            )}
          </AppButton>
        </div>
      </div>
      <MobileFilterSheet
        isOpen={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        title="絞り込み"
        activeFilterCount={incrementalSearch.activeFilterCount}
        onReset={() => {
          incrementalSearch.setStatusFilter('');
          incrementalSearch.setCategoryFilter('');
        }}
        onApply={() => {/* filters already applied via state */}}
      >
        <Form.Group className="mb-3">
          <Form.Label className="fw-semibold small">ステータス</Form.Label>
          {DRUG_MASTER_STATUS_OPTIONS.map((opt) => (
            <Form.Check
              key={opt.value}
              type="radio"
              id={`status-filter-${opt.value || 'all'}`}
              name="statusFilter"
              label={opt.label}
              checked={statusFilter === opt.value}
              onChange={() => incrementalSearch.setStatusFilter(opt.value)}
            />
          ))}
        </Form.Group>
        <Form.Group>
          <Form.Label className="fw-semibold small">区分</Form.Label>
          {DRUG_MASTER_CATEGORY_OPTIONS.map((opt) => (
            <Form.Check
              key={opt.value}
              type="radio"
              id={`category-filter-${opt.value || 'all'}`}
              name="categoryFilter"
              label={opt.label}
              checked={categoryFilter === opt.value}
              onChange={() => incrementalSearch.setCategoryFilter(opt.value)}
            />
          ))}
        </Form.Group>
      </MobileFilterSheet>

      <div className="mb-2">
        <SearchChips
          tokens={incrementalSearch.tokens}
          onRemove={incrementalSearch.handleRemoveToken}
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
      <Pagination
        currentPage={incrementalSearch.page}
        totalPages={incrementalSearch.totalPages}
        onPageChange={incrementalSearch.setPage}
      />
      </div>
      </ScrollArea>

      <DrugMasterDetailModal
        detail={detail}
        show={showDetail}
        onHide={closeDetail}
      />

      <DrugMasterEditModal
        editItem={editItem}
        show={showEdit}
        editSaving={editSaving}
        onHide={closeEdit}
        onEditItemChange={setEditItem}
        onSave={handleEditSave}
      />
    </PageShell>
  );
}
