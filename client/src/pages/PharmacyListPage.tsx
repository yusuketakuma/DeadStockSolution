import { useState, useEffect, useCallback } from 'react';
import { Table, Form, Button, Badge, Row, Col, Alert } from 'react-bootstrap';
import { api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import Pagination from '../components/Pagination';
import SearchInput from '../components/SearchInput';
import BusinessStatusBadge, { type BusinessHoursStatus } from '../components/BusinessStatusBadge';

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

  const fetchRelationships = useCallback(async () => {
    try {
      const data = await api.get<RelationshipsResponse>('/pharmacies/relationships');
      setFavoriteIds(new Set(data.favorites.map((r) => r.targetPharmacyId)));
      setBlockedIds(new Set(data.blocked.map((r) => r.targetPharmacyId)));
    } catch {
      // Silently fail - relationships are supplementary
    }
  }, []);

  const fetchData = async (p: number) => {
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
    }
  };

  useEffect(() => { fetchData(page); }, [page, search, prefecture, sortBy]);
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
        if (!confirm('この薬局をブロックしますか？\nブロックするとマッチング候補に表示されなくなります。')) return;
        await api.post(`/pharmacies/${pharmacyId}/block`);
      }
      await fetchRelationships();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'ブロック操作に失敗しました');
    }
  };

  return (
    <div>
      <h4 className="mb-3">登録薬局一覧</h4>

      {message && <Alert variant="danger" dismissible onClose={() => setMessage('')}>{message}</Alert>}

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
            <Button variant="primary" onClick={() => handleSearch(searchInput)}>検索</Button>
          </div>
        </Col>
        <Col md={4}>
          <Form.Select value={prefecture} onChange={(e) => { setPrefecture(e.target.value); setPage(1); }}>
            <option value="">全都道府県</option>
            {PREFECTURES.map((pref) => (
              <option key={pref} value={pref}>{pref}</option>
            ))}
          </Form.Select>
        </Col>
        <Col md={3}>
          <Form.Select value={sortBy} onChange={(e) => { setSortBy(e.target.value); setPage(1); }}>
            <option value="">登録順</option>
            <option value="distance">距離が近い順</option>
          </Form.Select>
        </Col>
      </Row>

      {pharmacies.length === 0 ? (
        <Alert variant="secondary">薬局が見つかりません。</Alert>
      ) : (
        <div className="table-responsive">
          <Table striped hover>
            <thead className="table-light">
              <tr>
                <th>薬局名</th>
                <th>都道府県</th>
                <th>住所</th>
                <th>電話</th>
                <th>FAX</th>
                <th>営業状況</th>
                <th>距離</th>
                <th style={{ minWidth: '120px' }}>操作</th>
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
                        <Button
                          size="sm"
                          variant={favoriteIds.has(p.id) ? 'warning' : 'outline-warning'}
                          title={favoriteIds.has(p.id) ? 'お気に入り解除' : 'お気に入り追加'}
                          onClick={() => toggleFavorite(p.id)}
                        >
                          {favoriteIds.has(p.id) ? '\u2605' : '\u2606'}
                        </Button>
                        <Button
                          size="sm"
                          variant={blockedIds.has(p.id) ? 'dark' : 'outline-secondary'}
                          title={blockedIds.has(p.id) ? 'ブロック解除' : 'ブロック'}
                          onClick={() => toggleBlock(p.id)}
                        >
                          {blockedIds.has(p.id) ? '\u2715' : '\u2298'}
                        </Button>
                      </div>
                    ) : (
                      <span className="text-muted small">自分</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
