import { useState, useEffect, useCallback } from 'react';
import AppTable from '../components/ui/AppTable';
import AppButton from '../components/ui/AppButton';
import AppAlert from '../components/ui/AppAlert';
import { Badge, Row, Col } from 'react-bootstrap';
import { api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import Pagination from '../components/Pagination';
import SearchInput from '../components/SearchInput';
import BusinessStatusBadge, { type BusinessHoursStatus } from '../components/BusinessStatusBadge';
import ConfirmActionModal from '../components/ConfirmActionModal';
import AppSelect from '../components/ui/AppSelect';
import AppEmptyState from '../components/ui/AppEmptyState';
import InlineLoader from '../components/ui/InlineLoader';
import AppMobileDataCard from '../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../components/ui/AppResponsiveSwitch';
import PageShell, { ScrollArea } from '../components/ui/PageShell';

const PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県',
  '岐阜県', '静岡県', '愛知県', '三重県',
  '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
  '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県',
  '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
];

interface Pharmacy {
  id: number;
  name: string;
  prefecture: string;
  address: string;
  phone: string;
  fax: string;
  distance: number | null;
  businessStatus?: BusinessHoursStatus;
}

interface PharmaciesResponse {
  data: Pharmacy[];
  pagination: { page: number; totalPages: number; total: number };
}

interface RelationshipItem {
  id: number;
  targetPharmacyId: number;
  relationshipType: 'favorite' | 'blocked';
  targetPharmacyName: string;
}

interface RelationshipsResponse {
  favorites: RelationshipItem[];
  blocked: RelationshipItem[];
}

export default function PharmacyListPage() {
  const { user } = useAuth();
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [prefecture, setPrefecture] = useState('');
  const [sortBy, setSortBy] = useState('');
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(new Set());
  const [blockedIds, setBlockedIds] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingBlockId, setPendingBlockId] = useState<number | null>(null);
  const [blockSubmitting, setBlockSubmitting] = useState(false);

  const fetchRelationships = useCallback(async () => {
    try {
      const data = await api.get<RelationshipsResponse>('/pharmacies/relationships');
      setFavoriteIds(new Set(data.favorites.map((r) => r.targetPharmacyId)));
      setBlockedIds(new Set(data.blocked.map((r) => r.targetPharmacyId)));
    } catch {
      // Silently fail - relationships are supplementary
    }
  }, []);

  const fetchData = useCallback(async (p: number) => {
    setLoading(true);
    setMessage('');
    try {
      const params = new URLSearchParams({ page: String(p) });
      if (search) params.set('search', search);
      if (prefecture) params.set('prefecture', prefecture);
      if (sortBy) params.set('sortBy', sortBy);
      const data = await api.get<PharmaciesResponse>(`/pharmacies?${params}`);
      setPharmacies(data.data);
      setTotalPages(data.pagination.totalPages);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '薬局一覧の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [search, prefecture, sortBy]);

  useEffect(() => { void fetchData(page); }, [page, fetchData]);
  useEffect(() => { fetchRelationships(); }, [fetchRelationships]);

  const handleSearch = (q: string) => {
    setPage(1);
    setSearch(q);
  };

  const toggleFavorite = async (pharmacyId: number) => {
    setMessage('');
    try {
      if (favoriteIds.has(pharmacyId)) {
        await api.delete(`/pharmacies/${pharmacyId}/favorite`);
      } else {
        await api.post(`/pharmacies/${pharmacyId}/favorite`);
      }
      await fetchRelationships();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'お気に入り操作に失敗しました');
    }
  };

  const toggleBlock = async (pharmacyId: number) => {
    setMessage('');
    try {
      if (blockedIds.has(pharmacyId)) {
        await api.delete(`/pharmacies/${pharmacyId}/block`);
      } else {
        setPendingBlockId(pharmacyId);
        return;
      }
      await fetchRelationships();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'ブロック操作に失敗しました');
    }
  };

  const confirmBlock = async () => {
    if (pendingBlockId === null) return;
    setBlockSubmitting(true);
    setMessage('');
    try {
      await api.post(`/pharmacies/${pendingBlockId}/block`);
      await fetchRelationships();
      setPendingBlockId(null);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'ブロック操作に失敗しました');
    } finally {
      setBlockSubmitting(false);
    }
  };

  const pendingBlockPharmacy = pendingBlockId === null
    ? null
    : pharmacies.find((p) => p.id === pendingBlockId) ?? null;

  return (
    <PageShell>
      <h4 className="page-title mb-3">登録薬局一覧</h4>

      <Row className="mb-3 g-2">
        <Col md={5}>
          <div className="d-flex gap-2">
            <div className="flex-grow-1">
              <SearchInput
                placeholder="薬局名で検索（ひらがな・カタカナ対応）..."
                value={searchInput}
                onChange={setSearchInput}
                onSearch={handleSearch}
                suggestUrl="/search/pharmacies"
              />
            </div>
            <AppButton variant="primary" onClick={() => handleSearch(searchInput)}>検索</AppButton>
          </div>
        </Col>
        <Col md={4}>
          <AppSelect
            value={prefecture}
            ariaLabel="都道府県で絞り込み"
            onChange={(value) => { setPrefecture(value); setPage(1); }}
            placeholder="全都道府県"
            options={PREFECTURES.map((pref) => ({ value: pref, label: pref }))}
          />
        </Col>
        <Col md={3}>
          <AppSelect
            value={sortBy}
            ariaLabel="並び順"
            onChange={(value) => { setSortBy(value); setPage(1); }}
            options={[
              { value: '', label: '登録順' },
              { value: 'distance', label: '距離が近い順' },
            ]}
          />
        </Col>
      </Row>

      <ScrollArea>
      {message ? (
        <AppAlert variant="danger" dismissible onClose={() => setMessage('')}>{message}</AppAlert>
      ) : loading ? (
        <InlineLoader text="薬局一覧を読み込み中..." className="text-muted small" />
      ) : pharmacies.length === 0 ? (
        <AppEmptyState
          title={search ? `「${search}」に一致する薬局が見つかりません` : '薬局が見つかりません'}
          description={search ? '検索条件を変更して再度お試しください。' : undefined}
        />
      ) : (
        <AppResponsiveSwitch
          desktop={() => (
            <div className="table-responsive">
              <AppTable striped hover>
                <thead className="table-light">
                  <tr>
                    <th>薬局名</th>
                    <th>都道府県</th>
                    <th>住所</th>
                    <th>電話</th>
                    <th>FAX</th>
                    <th>営業状況</th>
                    <th>距離</th>
                    <th className="table-col-actions">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {pharmacies.map((p) => (
                    <tr key={p.id} className={blockedIds.has(p.id) ? 'table-secondary' : ''}>
                      <td>
                        {p.name}
                        {favoriteIds.has(p.id) && <Badge bg="warning" className="ms-1" text="dark">お気に入り</Badge>}
                        {blockedIds.has(p.id) && <Badge bg="dark" className="ms-1">ブロック</Badge>}
                      </td>
                      <td>{p.prefecture}</td>
                      <td className="small">{p.address}</td>
                      <td>{p.phone}</td>
                      <td>{p.fax}</td>
                      <td><BusinessStatusBadge status={p.businessStatus} showHours fallback="dash" /></td>
                      <td>
                        {p.distance !== null ? (
                          <Badge bg="info">{p.distance}km</Badge>
                        ) : '-'}
                      </td>
                      <td>
                        {p.id !== user?.id ? (
                          <div className="d-flex gap-1">
                            <AppButton
                              size="sm"
                              variant={favoriteIds.has(p.id) ? 'warning' : 'outline-warning'}
                              title={favoriteIds.has(p.id) ? 'お気に入り解除' : 'お気に入り追加'}
                              aria-label={favoriteIds.has(p.id) ? `${p.name}のお気に入りを解除` : `${p.name}をお気に入りに追加`}
                              onClick={() => toggleFavorite(p.id)}
                            >
                              {favoriteIds.has(p.id) ? 'お気に入り解除' : 'お気に入り'}
                            </AppButton>
                            <AppButton
                              size="sm"
                              variant={blockedIds.has(p.id) ? 'dark' : 'outline-secondary'}
                              title={blockedIds.has(p.id) ? 'ブロック解除' : 'ブロック'}
                              aria-label={blockedIds.has(p.id) ? `${p.name}のブロックを解除` : `${p.name}をブロック`}
                              onClick={() => toggleBlock(p.id)}
                            >
                              {blockedIds.has(p.id) ? 'ブロック解除' : 'ブロック'}
                            </AppButton>
                          </div>
                        ) : (
                          <span className="text-muted small">自分</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </AppTable>
            </div>
          )}
          mobile={() => (
            <div className="dl-mobile-data-list">
              {pharmacies.map((p) => (
                <AppMobileDataCard
                  key={p.id}
                  className={blockedIds.has(p.id) ? 'border-secondary-subtle bg-light' : undefined}
                  title={p.name}
                  subtitle={p.prefecture}
                  badges={(
                    <>
                      {favoriteIds.has(p.id) && <Badge bg="warning" text="dark">お気に入り</Badge>}
                      {blockedIds.has(p.id) && <Badge bg="dark">ブロック</Badge>}
                      {p.distance !== null ? <Badge bg="info">{p.distance}km</Badge> : null}
                    </>
                  )}
                  fields={[
                    { label: '住所', value: p.address },
                    { label: '電話', value: p.phone },
                    { label: 'FAX', value: p.fax },
                    { label: '営業状況', value: <BusinessStatusBadge status={p.businessStatus} showHours fallback="dash" /> },
                  ]}
                  actions={p.id !== user?.id ? (
                    <>
                      <AppButton
                        size="sm"
                        variant={favoriteIds.has(p.id) ? 'warning' : 'outline-warning'}
                        title={favoriteIds.has(p.id) ? 'お気に入り解除' : 'お気に入り追加'}
                        aria-label={favoriteIds.has(p.id) ? `${p.name}のお気に入りを解除` : `${p.name}をお気に入りに追加`}
                        onClick={() => toggleFavorite(p.id)}
                      >
                        {favoriteIds.has(p.id) ? 'お気に入り解除' : 'お気に入り'}
                      </AppButton>
                      <AppButton
                        size="sm"
                        variant={blockedIds.has(p.id) ? 'dark' : 'outline-secondary'}
                        title={blockedIds.has(p.id) ? 'ブロック解除' : 'ブロック'}
                        aria-label={blockedIds.has(p.id) ? `${p.name}のブロックを解除` : `${p.name}をブロック`}
                        onClick={() => toggleBlock(p.id)}
                      >
                        {blockedIds.has(p.id) ? 'ブロック解除' : 'ブロック'}
                      </AppButton>
                    </>
                  ) : (
                    <span className="text-muted small">自分の薬局です</span>
                  )}
                />
              ))}
            </div>
          )}
        />
      )}
      </ScrollArea>
      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />

      <ConfirmActionModal
        show={pendingBlockId !== null}
        title="薬局のブロック"
        body={pendingBlockPharmacy
          ? `「${pendingBlockPharmacy.name}」をブロックします。ブロックするとマッチング候補に表示されなくなります。`
          : 'この薬局をブロックします。ブロックするとマッチング候補に表示されなくなります。'}
        confirmLabel="ブロックする"
        confirmVariant="danger"
        onCancel={() => setPendingBlockId(null)}
        onConfirm={confirmBlock}
        pending={blockSubmitting}
      />
    </PageShell>
  );
}
