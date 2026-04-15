import { useCallback, useEffect, useState } from 'react';
import { Badge, Form, Modal, Table } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import AppAlert from '../components/ui/AppAlert';
import AppButton from '../components/ui/AppButton';
import AppCard from '../components/ui/AppCard';
import AppEmptyState from '../components/ui/AppEmptyState';
import ErrorRetryAlert from '../components/ui/ErrorRetryAlert';
import InlineLoader from '../components/ui/InlineLoader';
import LoadingButton from '../components/ui/LoadingButton';
import PageShell, { ScrollArea } from '../components/ui/PageShell';
import Pagination from '../components/Pagination';
import AppMobileDataCard from '../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../components/ui/AppResponsiveSwitch';
import {
  type Bookmark,
  deleteBookmark,
  fetchBookmarksPage,
  updateBookmarkMemo,
} from '../api/match-bookmarks';
import { formatDateTimeJa } from '../utils/formatters';

const PAGE_SIZE = 20;

function buildMatchingCandidateLink(bookmark: Bookmark): string {
  return `/matching?targetPharmacyId=${bookmark.candidatePharmacyId}`;
}

export default function BookmarksPage() {
  const [items, setItems] = useState<Bookmark[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // memo edit modal state
  const [editTarget, setEditTarget] = useState<Bookmark | null>(null);
  const [editMemo, setEditMemo] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  // delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<Bookmark | null>(null);
  const [deleteConfirming, setDeleteConfirming] = useState(false);

  const loadPage = useCallback(async (p: number) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchBookmarksPage(p, PAGE_SIZE);
      setItems(res.items);
      setPage(res.page);
      // If a full page was returned, there may be more — allow navigation to p+1
      setTotalPages(res.items.length === PAGE_SIZE ? p + 1 : p);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ブックマーク一覧の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPage(1);
  }, [loadPage]);

  const handlePageChange = (newPage: number) => {
    void loadPage(newPage);
  };

  const openEditModal = (bookmark: Bookmark) => {
    setEditTarget(bookmark);
    setEditMemo(bookmark.memo ?? '');
    setEditError('');
  };

  const closeEditModal = () => {
    setEditTarget(null);
    setEditMemo('');
    setEditError('');
  };

  const handleSaveMemo = async () => {
    if (!editTarget) return;
    setEditSaving(true);
    setEditError('');
    try {
      const updated = await updateBookmarkMemo(editTarget.id, editMemo);
      setItems((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
      setSuccessMessage('メモを更新しました');
      closeEditModal();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'メモの更新に失敗しました');
    } finally {
      setEditSaving(false);
    }
  };

  const openDeleteConfirm = (bookmark: Bookmark) => {
    setDeleteTarget(bookmark);
  };

  const closeDeleteConfirm = () => {
    setDeleteTarget(null);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteConfirming(true);
    try {
      await deleteBookmark(deleteTarget.id);
      setItems((prev) => prev.filter((b) => b.id !== deleteTarget.id));
      setSuccessMessage('ブックマークを削除しました');
      closeDeleteConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ブックマークの削除に失敗しました');
      closeDeleteConfirm();
    } finally {
      setDeleteConfirming(false);
    }
  };

  return (
    <PageShell>
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">ブックマーク</h4>
          <div className="text-muted small">保存した候補からマッチングや一覧確認へ戻れます。</div>
        </div>
        <div className="dl-page-header-actions d-flex gap-2 flex-wrap">
          <Link to="/matching" className="btn btn-outline-primary btn-sm">候補を探す</Link>
          <Link to="/proposals" className="btn btn-outline-secondary btn-sm">提案一覧を確認</Link>
          <Link to="/inventory/browse" className="btn btn-outline-secondary btn-sm">在庫を確認</Link>
        </div>
      </div>
      <ScrollArea>
        {error && (
          <ErrorRetryAlert
            error={error}
            onRetry={() => { void loadPage(page); }}
          />
        )}
        {successMessage && (
          <AppAlert variant="success" onClose={() => setSuccessMessage('')} dismissible>
            {successMessage}
          </AppAlert>
        )}

        <AppCard className="mb-3">
          <AppCard.Body>
            <p className="mb-0 text-muted small">
              マッチング候補としてブックマークした薬局・薬品の一覧です。
            </p>
          </AppCard.Body>
        </AppCard>

        <AppCard className="mb-3">
          <AppCard.Header>次にやること</AppCard.Header>
          <AppCard.Body className="d-flex gap-2 flex-wrap">
            <Link to="/matching" className="btn btn-outline-primary btn-sm">候補を探す</Link>
            <Link to="/proposals" className="btn btn-outline-secondary btn-sm">提案一覧を確認</Link>
            <Link to="/messages" className="btn btn-outline-secondary btn-sm">メッセージを確認</Link>
          </AppCard.Body>
        </AppCard>

        {loading && <InlineLoader />}

        {!loading && items.length === 0 && !error && (
          <AppEmptyState
            title="ブックマークがありません"
            description="マッチングページで候補薬局をブックマークすると、ここに表示されます。"
            actionLabel="候補を探す"
            actionTo="/matching"
          />
        )}

        {!loading && items.length > 0 && (
          <AppCard className="mb-3">
            <AppCard.Body className="p-0">
              <AppResponsiveSwitch
                desktop={() => (
                  <div className="table-responsive">
                    <Table size="sm" striped className="mb-0">
                      <thead>
                        <tr>
                          <th>候補薬局</th>
                          <th>薬品コード</th>
                          <th>メモ</th>
                          <th>ブックマーク日時</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((b) => (
                          <tr key={b.id}>
                            <td>{b.candidatePharmacyName ?? <span className="text-muted">—</span>}</td>
                            <td>
                              <Badge bg="secondary">{b.drugCode}</Badge>
                            </td>
                            <td>
                              {b.memo
                                ? <span>{b.memo}</span>
                                : <span className="text-muted small">—</span>}
                            </td>
                            <td className="text-nowrap small text-muted">
                              {formatDateTimeJa(b.createdAt)}
                            </td>
                            <td className="text-nowrap">
                              <Link to={buildMatchingCandidateLink(b)} className="btn btn-outline-primary btn-sm me-1">
                                候補を確認
                              </Link>
                              <AppButton
                                type="button"
                                variant="outline-secondary"
                                size="sm"
                                className="me-1"
                                onClick={() => openEditModal(b)}
                              >
                                メモ編集
                              </AppButton>
                              <AppButton
                                type="button"
                                variant="outline-danger"
                                size="sm"
                                onClick={() => openDeleteConfirm(b)}
                              >
                                削除
                              </AppButton>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                )}
                mobile={() => (
                  <div className="dl-mobile-data-list p-2">
                    {items.map((b) => (
                      <AppMobileDataCard
                        key={b.id}
                        title={b.candidatePharmacyName ?? '—'}
                        fields={[
                          { label: '薬品コード', value: b.drugCode },
                          { label: 'メモ', value: b.memo || '—' },
                          { label: 'ブックマーク日時', value: formatDateTimeJa(b.createdAt) },
                        ]}
                        actions={
                          <div className="d-flex gap-2 mt-2">
                            <Link to={buildMatchingCandidateLink(b)} className="btn btn-outline-primary btn-sm">
                              候補を確認
                            </Link>
                            <AppButton
                              type="button"
                              variant="outline-secondary"
                              size="sm"
                              onClick={() => openEditModal(b)}
                            >
                              メモ編集
                            </AppButton>
                            <AppButton
                              type="button"
                              variant="outline-danger"
                              size="sm"
                              onClick={() => openDeleteConfirm(b)}
                            >
                              削除
                            </AppButton>
                          </div>
                        }
                      />
                    ))}
                  </div>
                )}
              />
            </AppCard.Body>
          </AppCard>
        )}

        {totalPages > 1 && (
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            onPageChange={handlePageChange}
          />
        )}
      </ScrollArea>

      {/* メモ編集モーダル */}
      <Modal show={editTarget !== null} onHide={closeEditModal} centered>
        <Modal.Header closeButton>
          <Modal.Title>メモを編集</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {editError && <AppAlert variant="danger">{editError}</AppAlert>}
          {editTarget && (
            <div className="mb-3 small text-muted">
              {editTarget.candidatePharmacyName ?? '薬局不明'} — {editTarget.drugCode}
            </div>
          )}
          <Form.Group>
            <Form.Label>メモ</Form.Label>
            <Form.Control
              as="textarea"
              rows={3}
              value={editMemo}
              onChange={(e) => setEditMemo(e.target.value)}
              placeholder="メモを入力（任意）"
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <AppButton type="button" variant="secondary" onClick={closeEditModal}>
            キャンセル
          </AppButton>
          <LoadingButton
            variant="primary"
            onClick={handleSaveMemo}
            loading={editSaving}
            loadingLabel="保存中..."
          >
            保存
          </LoadingButton>
        </Modal.Footer>
      </Modal>

      {/* 削除確認モーダル */}
      <Modal show={deleteTarget !== null} onHide={closeDeleteConfirm} centered>
        <Modal.Header closeButton>
          <Modal.Title>ブックマークを削除</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {deleteTarget && (
            <p>
              <strong>{deleteTarget.candidatePharmacyName ?? '薬局不明'}</strong>（{deleteTarget.drugCode}）のブックマークを削除しますか？
            </p>
          )}
        </Modal.Body>
        <Modal.Footer>
          <AppButton type="button" variant="secondary" onClick={closeDeleteConfirm}>
            キャンセル
          </AppButton>
          <LoadingButton
            variant="danger"
            onClick={handleDelete}
            loading={deleteConfirming}
            loadingLabel="削除中..."
          >
            削除する
          </LoadingButton>
        </Modal.Footer>
      </Modal>
    </PageShell>
  );
}
