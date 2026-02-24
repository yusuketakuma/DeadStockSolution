import { useState, useEffect, useRef, FormEvent } from 'react';
import {
  Card, Row, Col, Table, Badge, Button, Alert,
  Form, Modal, Spinner, InputGroup,
} from 'react-bootstrap';
import { api, apiUpload } from '../../api/client';
import Pagination from '../../components/Pagination';

// ── 型定義 ──────────────────────────────────────

interface DrugMasterItem {
  id: number;
  yjCode: string;
  drugName: string;
  genericName: string | null;
  specification: string | null;
  unit: string | null;
  yakkaPrice: number;
  manufacturer: string | null;
  category: string | null;
  isListed: boolean;
  transitionDeadline: string | null;
  updatedAt: string | null;
}

interface DrugMasterDetail extends DrugMasterItem {
  therapeuticCategory: string | null;
  listedDate: string | null;
  deletedDate: string | null;
  packages: PackageItem[];
  priceHistory: PriceHistoryItem[];
}

interface PackageItem {
  id: number;
  gs1Code: string | null;
  janCode: string | null;
  hotCode: string | null;
  packageDescription: string | null;
  packageQuantity: number | null;
  packageUnit: string | null;
}

interface PriceHistoryItem {
  id: number;
  yjCode: string;
  previousPrice: number | null;
  newPrice: number | null;
  revisionDate: string;
  revisionType: string;
}

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

const REVISION_TYPE_LABELS: Record<string, string> = {
  price_revision: '薬価改定',
  new_listing: '新規収載',
  delisting: '薬価削除',
  transition: '経過措置',
};

const CATEGORY_OPTIONS = ['内用薬', '外用薬', '注射薬', '歯科用薬剤'];

// ── メインコンポーネント ─────────────────────────────

export default function AdminDrugMasterPage() {
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
  const [syncResult, setSyncResult] = useState('');
  const [syncError, setSyncError] = useState('');
  const [revisionDate, setRevisionDate] = useState(new Date().toISOString().slice(0, 10));
  const syncFileRef = useRef<HTMLInputElement>(null);
  const pkgFileRef = useRef<HTMLInputElement>(null);

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

  const fetchStats = async () => {
    try {
      const data = await api.get<Stats>('/admin/drug-master/stats');
      setStats(data);
    } catch { /* ignore */ }
  };

  const fetchItems = async (p: number) => {
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
  };

  const fetchSyncLogs = async () => {
    try {
      const data = await api.get<{ data: SyncLog[] }>('/admin/drug-master/sync-logs');
      setSyncLogs(data.data.slice(0, 5));
    } catch { /* ignore */ }
  };

  useEffect(() => {
    fetchStats();
    fetchSyncLogs();
  }, []);

  useEffect(() => {
    fetchItems(page);
  }, [page, search, statusFilter, categoryFilter]);

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

    setSyncing(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const result = await apiUpload<{ message: string; result: { added: number; updated: number } }>(
        '/admin/drug-master/upload-packages', formData
      );
      setMessage(`包装単位登録完了: 追加 ${result.result.added}件 / 更新 ${result.result.updated}件`);
      if (pkgFileRef.current) pkgFileRef.current.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : '登録に失敗しました');
    } finally {
      setSyncing(false);
    }
  };

  // ── 詳細表示 ────────────────────────────────────

  const openDetail = async (yjCode: string) => {
    try {
      const data = await api.get<DrugMasterDetail>(`/admin/drug-master/detail/${yjCode}`);
      setDetail(data);
      setShowDetail(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '詳細の取得に失敗しました');
    }
  };

  // ── 編集 ───────────────────────────────────────

  const openEdit = async (yjCode: string) => {
    try {
      const data = await api.get<DrugMasterDetail>(`/admin/drug-master/detail/${yjCode}`);
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
      await api.put(`/admin/drug-master/detail/${editItem.yjCode}`, {
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
    <div>
      <h4 className="page-title mb-3">医薬品マスター管理</h4>

      {message && <Alert variant="success" onClose={() => setMessage('')} dismissible>{message}</Alert>}
      {error && <Alert variant="danger" onClose={() => setError('')} dismissible>{error}</Alert>}

      {/* 統計カード */}
      <Row className="g-3 mb-3">
        <Col md={4} xl>
          <Card className="text-center h-100">
            <Card.Body>
              <Card.Title className="display-6">{stats?.totalItems?.toLocaleString() ?? '-'}</Card.Title>
              <Card.Text className="text-muted small">総品目数</Card.Text>
            </Card.Body>
          </Card>
        </Col>
        <Col md={4} xl>
          <Card className="text-center h-100">
            <Card.Body>
              <Card.Title className="display-6">{stats?.listedItems?.toLocaleString() ?? '-'}</Card.Title>
              <Card.Text className="text-muted small">収載中</Card.Text>
            </Card.Body>
          </Card>
        </Col>
        <Col md={4} xl>
          <Card className="text-center h-100">
            <Card.Body>
              <Card.Title className="display-6">{stats?.transitionItems?.toLocaleString() ?? '-'}</Card.Title>
              <Card.Text className="text-muted small">経過措置中</Card.Text>
            </Card.Body>
          </Card>
        </Col>
        <Col md={4} xl>
          <Card className="text-center h-100">
            <Card.Body>
              <Card.Title className="display-6">{stats?.delistedItems?.toLocaleString() ?? '-'}</Card.Title>
              <Card.Text className="text-muted small">削除済</Card.Text>
            </Card.Body>
          </Card>
        </Col>
        <Col md={4} xl>
          <Card className="text-center h-100">
            <Card.Body>
              <div className="small">{stats?.lastSyncAt ? new Date(stats.lastSyncAt).toLocaleString('ja-JP') : '未実行'}</div>
              <Card.Text className="text-muted small">最終同期</Card.Text>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* 同期セクション */}
      <Row className="g-3 mb-3">
        <Col lg={6}>
          <Card>
            <Card.Header>薬価基準収載品目リストから同期</Card.Header>
            <Card.Body>
              <Form.Group className="mb-2">
                <Form.Label className="small">改定日</Form.Label>
                <Form.Control
                  type="date"
                  value={revisionDate}
                  onChange={(e) => setRevisionDate(e.target.value)}
                />
              </Form.Group>
              <Form.Group className="mb-2">
                <Form.Label className="small">ファイル（xlsx / csv）</Form.Label>
                <Form.Control type="file" ref={syncFileRef} accept=".xlsx,.csv" />
              </Form.Group>
              {syncResult && <Alert variant="success" className="py-1 small">{syncResult}</Alert>}
              {syncError && <Alert variant="danger" className="py-1 small">{syncError}</Alert>}
              <Button size="sm" onClick={handleSync} disabled={syncing}>
                {syncing ? <><Spinner size="sm" className="me-1" />同期中...</> : '同期実行'}
              </Button>
              <Form.Text className="d-block mt-1 text-muted">
                厚生労働省の薬価基準収載品目リスト（Excel/CSV）をアップロードしてください。
              </Form.Text>
            </Card.Body>
          </Card>
        </Col>
        <Col lg={6}>
          <Card>
            <Card.Header>包装単位データ登録（GS1/JAN/HOTコード）</Card.Header>
            <Card.Body>
              <Form.Group className="mb-2">
                <Form.Label className="small">ファイル（xlsx / csv）</Form.Label>
                <Form.Control type="file" ref={pkgFileRef} accept=".xlsx,.csv" />
              </Form.Group>
              <Button size="sm" onClick={handlePackageUpload} disabled={syncing}>
                {syncing ? <><Spinner size="sm" className="me-1" />登録中...</> : '登録実行'}
              </Button>
              <Form.Text className="d-block mt-1 text-muted">
                GS1コード・JANコード・HOTコードを含む包装単位データを登録します。
              </Form.Text>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* 同期ログ */}
      {syncLogs.length > 0 && (
        <Card className="mb-3">
          <Card.Header>同期ログ（最新5件）</Card.Header>
          <Card.Body className="p-0">
            <Table size="sm" responsive className="mb-0">
              <thead>
                <tr>
                  <th>日時</th>
                  <th>状態</th>
                  <th>ソース</th>
                  <th>処理</th>
                  <th>追加</th>
                  <th>更新</th>
                  <th>削除</th>
                  <th>エラー</th>
                </tr>
              </thead>
              <tbody>
                {syncLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="small">{log.startedAt ? new Date(log.startedAt).toLocaleString('ja-JP') : '-'}</td>
                    <td>
                      <Badge bg={log.status === 'success' ? 'success' : log.status === 'running' ? 'primary' : 'danger'}>
                        {log.status}
                      </Badge>
                    </td>
                    <td className="small text-truncate" style={{ maxWidth: 150 }}>{log.sourceDescription || '-'}</td>
                    <td>{log.itemsProcessed}</td>
                    <td>{log.itemsAdded}</td>
                    <td>{log.itemsUpdated}</td>
                    <td>{log.itemsDeleted}</td>
                    <td className="small text-danger text-truncate" style={{ maxWidth: 200 }}>{log.errorMessage || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card.Body>
        </Card>
      )}

      {/* 検索・フィルター */}
      <Card className="mb-3">
        <Card.Body>
          <Row className="g-2 align-items-end">
            <Col md={5}>
              <Form onSubmit={handleSearch}>
                <InputGroup size="sm">
                  <Form.Control
                    placeholder="品名・成分名・YJコードで検索"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                  />
                  <Button type="submit" variant="outline-primary">検索</Button>
                </InputGroup>
              </Form>
            </Col>
            <Col md={3}>
              <Form.Select size="sm" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
                <option value="">全ステータス</option>
                <option value="listed">収載中</option>
                <option value="transition">経過措置中</option>
                <option value="delisted">削除済</option>
              </Form.Select>
            </Col>
            <Col md={3}>
              <Form.Select size="sm" value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}>
                <option value="">全区分</option>
                {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </Form.Select>
            </Col>
            <Col md={1} className="text-end">
              <span className="small text-muted">{total.toLocaleString()}件</span>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      {/* 一覧テーブル */}
      {loading ? (
        <div className="text-center py-4"><Spinner /></div>
      ) : (
        <>
          <div className="table-responsive">
            <Table striped hover size="sm" className="mobile-table">
              <thead>
                <tr>
                  <th>YJコード</th>
                  <th>品名</th>
                  <th>成分名</th>
                  <th>規格</th>
                  <th className="text-end">薬価</th>
                  <th>単位</th>
                  <th>メーカー</th>
                  <th>状態</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr><td colSpan={9} className="text-center text-muted py-4">
                    {stats?.totalItems === 0
                      ? '医薬品マスターにデータがありません。薬価基準収載品目リストを同期してください。'
                      : '該当する医薬品が見つかりません。'}
                  </td></tr>
                ) : items.map((item) => (
                  <tr key={item.id}>
                    <td className="small font-monospace">{item.yjCode}</td>
                    <td>
                      <a href="#" onClick={(e) => { e.preventDefault(); openDetail(item.yjCode); }} className="text-decoration-none">
                        {item.drugName}
                      </a>
                    </td>
                    <td className="small">{item.genericName || '-'}</td>
                    <td className="small">{item.specification || '-'}</td>
                    <td className="text-end">{item.yakkaPrice.toLocaleString()}</td>
                    <td className="small">{item.unit || '-'}</td>
                    <td className="small">{item.manufacturer || '-'}</td>
                    <td>
                      {item.isListed ? (
                        item.transitionDeadline
                          ? <Badge bg="warning" text="dark">経過措置</Badge>
                          : <Badge bg="success">収載中</Badge>
                      ) : (
                        <Badge bg="secondary">削除済</Badge>
                      )}
                    </td>
                    <td>
                      <Button size="sm" variant="outline-secondary" onClick={() => openEdit(item.yjCode)}>
                        編集
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}

      {/* 詳細モーダル */}
      <Modal show={showDetail} onHide={() => setShowDetail(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title className="h6">医薬品詳細</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {detail && (
            <>
              <Row className="mb-3">
                <Col sm={4}><strong>YJコード</strong><div className="font-monospace">{detail.yjCode}</div></Col>
                <Col sm={4}><strong>薬価</strong><div>{detail.yakkaPrice.toLocaleString()}円</div></Col>
                <Col sm={4}><strong>状態</strong><div>
                  {detail.isListed
                    ? (detail.transitionDeadline ? `経過措置（${detail.transitionDeadline}まで）` : '収載中')
                    : `削除済（${detail.deletedDate || '-'}）`}
                </div></Col>
              </Row>
              <Row className="mb-3">
                <Col sm={6}><strong>品名</strong><div>{detail.drugName}</div></Col>
                <Col sm={6}><strong>一般名</strong><div>{detail.genericName || '-'}</div></Col>
              </Row>
              <Row className="mb-3">
                <Col sm={4}><strong>規格</strong><div>{detail.specification || '-'}</div></Col>
                <Col sm={4}><strong>単位</strong><div>{detail.unit || '-'}</div></Col>
                <Col sm={4}><strong>区分</strong><div>{detail.category || '-'}</div></Col>
              </Row>
              <Row className="mb-3">
                <Col sm={6}><strong>メーカー</strong><div>{detail.manufacturer || '-'}</div></Col>
                <Col sm={6}><strong>薬効分類番号</strong><div>{detail.therapeuticCategory || '-'}</div></Col>
              </Row>

              {detail.packages.length > 0 && (
                <>
                  <h6 className="mt-3">包装単位</h6>
                  <Table size="sm" bordered>
                    <thead>
                      <tr>
                        <th>GS1コード</th>
                        <th>JANコード</th>
                        <th>HOTコード</th>
                        <th>包装</th>
                        <th>数量</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.packages.map((pkg) => (
                        <tr key={pkg.id}>
                          <td className="font-monospace small">{pkg.gs1Code || '-'}</td>
                          <td className="font-monospace small">{pkg.janCode || '-'}</td>
                          <td className="font-monospace small">{pkg.hotCode || '-'}</td>
                          <td className="small">{pkg.packageDescription || '-'}</td>
                          <td className="small">{pkg.packageQuantity ?? '-'} {pkg.packageUnit || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </>
              )}

              {detail.priceHistory.length > 0 && (
                <>
                  <h6 className="mt-3">薬価改定履歴</h6>
                  <Table size="sm" bordered>
                    <thead>
                      <tr>
                        <th>日付</th>
                        <th>種別</th>
                        <th className="text-end">改定前</th>
                        <th className="text-end">改定後</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.priceHistory.map((ph) => (
                        <tr key={ph.id}>
                          <td className="small">{ph.revisionDate}</td>
                          <td><Badge bg="info">{REVISION_TYPE_LABELS[ph.revisionType] || ph.revisionType}</Badge></td>
                          <td className="text-end">{ph.previousPrice != null ? ph.previousPrice.toLocaleString() : '-'}</td>
                          <td className="text-end">{ph.newPrice != null ? ph.newPrice.toLocaleString() : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </>
              )}
            </>
          )}
        </Modal.Body>
      </Modal>

      {/* 編集モーダル */}
      <Modal show={showEdit} onHide={() => setShowEdit(false)}>
        <Modal.Header closeButton>
          <Modal.Title className="h6">医薬品情報の編集</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {editItem && (
            <Form>
              <Form.Group className="mb-2">
                <Form.Label className="small">YJコード</Form.Label>
                <Form.Control value={editItem.yjCode} disabled className="font-monospace" />
              </Form.Group>
              <Form.Group className="mb-2">
                <Form.Label className="small">品名</Form.Label>
                <Form.Control
                  value={editItem.drugName}
                  onChange={(e) => setEditItem({ ...editItem, drugName: e.target.value })}
                />
              </Form.Group>
              <Form.Group className="mb-2">
                <Form.Label className="small">一般名（成分名）</Form.Label>
                <Form.Control
                  value={editItem.genericName || ''}
                  onChange={(e) => setEditItem({ ...editItem, genericName: e.target.value || null })}
                />
              </Form.Group>
              <Row>
                <Col sm={6}>
                  <Form.Group className="mb-2">
                    <Form.Label className="small">規格</Form.Label>
                    <Form.Control
                      value={editItem.specification || ''}
                      onChange={(e) => setEditItem({ ...editItem, specification: e.target.value || null })}
                    />
                  </Form.Group>
                </Col>
                <Col sm={6}>
                  <Form.Group className="mb-2">
                    <Form.Label className="small">単位</Form.Label>
                    <Form.Control
                      value={editItem.unit || ''}
                      onChange={(e) => setEditItem({ ...editItem, unit: e.target.value || null })}
                    />
                  </Form.Group>
                </Col>
              </Row>
              <Row>
                <Col sm={6}>
                  <Form.Group className="mb-2">
                    <Form.Label className="small">薬価（円）</Form.Label>
                    <Form.Control
                      type="number"
                      step="0.01"
                      min="0"
                      value={editItem.yakkaPrice}
                      onChange={(e) => setEditItem({ ...editItem, yakkaPrice: Number(e.target.value) || 0 })}
                    />
                  </Form.Group>
                </Col>
                <Col sm={6}>
                  <Form.Group className="mb-2">
                    <Form.Label className="small">メーカー</Form.Label>
                    <Form.Control
                      value={editItem.manufacturer || ''}
                      onChange={(e) => setEditItem({ ...editItem, manufacturer: e.target.value || null })}
                    />
                  </Form.Group>
                </Col>
              </Row>
              <Row>
                <Col sm={6}>
                  <Form.Check
                    type="switch"
                    label="薬価基準収載中"
                    checked={editItem.isListed}
                    onChange={(e) => setEditItem({ ...editItem, isListed: e.target.checked })}
                    className="mb-2"
                  />
                </Col>
                <Col sm={6}>
                  <Form.Group className="mb-2">
                    <Form.Label className="small">経過措置期限</Form.Label>
                    <Form.Control
                      type="date"
                      value={editItem.transitionDeadline || ''}
                      onChange={(e) => setEditItem({ ...editItem, transitionDeadline: e.target.value || null })}
                    />
                  </Form.Group>
                </Col>
              </Row>
            </Form>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" size="sm" onClick={() => setShowEdit(false)}>キャンセル</Button>
          <Button variant="primary" size="sm" onClick={handleEditSave} disabled={editSaving}>
            {editSaving ? '保存中...' : '保存'}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
