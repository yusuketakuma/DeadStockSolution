import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Card, Col, Form, Row, Spinner } from 'react-bootstrap';
import { api } from '../../api/client';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';

interface MatchingRuleProfile {
  id: number;
  profileName: string;
  isActive: boolean;
  version: number;
  createdAt: string | null;
  updatedAt: string | null;
  source: string;
  nameMatchThreshold: number;
  valueScoreMax: number;
  valueScoreDivisor: number;
  balanceScoreMax: number;
  balanceScoreDiffFactor: number;
  distanceScoreMax: number;
  distanceScoreDivisor: number;
  distanceScoreFallback: number;
  nearExpiryScoreMax: number;
  nearExpiryItemFactor: number;
  nearExpiryDays: number;
  diversityScoreMax: number;
  diversityItemFactor: number;
  favoriteBonus: number;
  groupBonus: number;
  nearExpiryDecayCurve: number;
  successRateBonus: number;
  maxCandidates: number;
}

interface FieldConfig {
  key: keyof MatchingRuleProfile;
  label: string;
  min: number;
  max: number;
  step: number;
  description: string;
}

const FIELD_GROUPS: { title: string; fields: FieldConfig[] }[] = [
  {
    title: '薬品名マッチング',
    fields: [
      { key: 'nameMatchThreshold', label: '名前一致閾値', min: 0, max: 1, step: 0.05, description: '薬品名の類似度がこの値以上でマッチとみなす' },
    ],
  },
  {
    title: '薬価スコア',
    fields: [
      { key: 'valueScoreMax', label: '最大スコア', min: 0, max: 200, step: 1, description: '薬価スコアの最大値' },
      { key: 'valueScoreDivisor', label: '除数', min: 1, max: 1000000, step: 100, description: '薬価を割る値（大きいほどスコアが低くなる）' },
    ],
  },
  {
    title: 'バランススコア',
    fields: [
      { key: 'balanceScoreMax', label: '最大スコア', min: 0, max: 200, step: 1, description: '交換バランスの最大スコア' },
      { key: 'balanceScoreDiffFactor', label: '差分係数', min: 0, max: 1000, step: 0.1, description: '差額に対するペナルティ係数' },
    ],
  },
  {
    title: '距離スコア',
    fields: [
      { key: 'distanceScoreMax', label: '最大スコア', min: 0, max: 200, step: 1, description: '距離スコアの最大値' },
      { key: 'distanceScoreDivisor', label: '除数', min: 1, max: 1000000, step: 1, description: '距離を割る値' },
      { key: 'distanceScoreFallback', label: 'フォールバック', min: 0, max: 200, step: 1, description: '距離不明時のスコア' },
    ],
  },
  {
    title: '期限切れスコア',
    fields: [
      { key: 'nearExpiryScoreMax', label: '最大スコア', min: 0, max: 200, step: 1, description: '期限切れスコアの最大値' },
      { key: 'nearExpiryItemFactor', label: 'アイテム係数', min: 0, max: 100, step: 0.1, description: '期限切れアイテム数に対する係数' },
      { key: 'nearExpiryDays', label: '期限日数', min: 1, max: 365, step: 1, description: '期限切れとみなす日数' },
      { key: 'nearExpiryDecayCurve', label: '減衰カーブ', min: 0, max: 10, step: 0.1, description: '指数減衰の強さ（0=線形、大きいほど急激）' },
    ],
  },
  {
    title: '多様性スコア',
    fields: [
      { key: 'diversityScoreMax', label: '最大スコア', min: 0, max: 200, step: 1, description: '多様性スコアの最大値' },
      { key: 'diversityItemFactor', label: 'アイテム係数', min: 0, max: 100, step: 0.1, description: '多様性アイテム数に対する係数' },
    ],
  },
  {
    title: 'ボーナス・候補数',
    fields: [
      { key: 'favoriteBonus', label: 'お気に入りボーナス', min: 0, max: 200, step: 1, description: 'お気に入り薬局への加点' },
      { key: 'groupBonus', label: 'グループボーナス', min: 0, max: 50, step: 1, description: '同一グループ薬局への加点' },
      { key: 'successRateBonus', label: '成功率ボーナス', min: 0, max: 50, step: 1, description: '交換成功実績に基づく加点' },
      { key: 'maxCandidates', label: '最大候補数', min: 1, max: 200, step: 1, description: 'マッチング候補の最大表示件数' },
    ],
  },
];

export default function AdminMatchingRulesPage() {
  const [profile, setProfile] = useState<MatchingRuleProfile | null>(null);
  const [editValues, setEditValues] = useState<Partial<Record<keyof MatchingRuleProfile, number>>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<{ data: MatchingRuleProfile }>('/admin/matching-rules/profile');
      setProfile(res.data);
      setEditValues({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'プロファイルの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  const handleChange = (key: keyof MatchingRuleProfile, value: string) => {
    const numValue = Number(value);
    if (Number.isNaN(numValue)) return;
    setEditValues((prev) => ({ ...prev, [key]: numValue }));
    setSuccess('');
  };

  const hasChanges = Object.keys(editValues).length > 0;

  const handleSave = async () => {
    if (!profile || !hasChanges) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await api.put<{ data: MatchingRuleProfile; message: string }>(
        '/admin/matching-rules/profile',
        { ...editValues, expectedVersion: profile.version },
      );
      setProfile(res.data);
      setEditValues({});
      setSuccess(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setEditValues({});
    setSuccess('');
  };

  const getCurrentValue = (key: keyof MatchingRuleProfile): number => {
    if (key in editValues) return editValues[key] as number;
    if (profile) return profile[key] as number;
    return 0;
  };

  if (loading) {
    return (
      <PageShell>
        <div className="text-center py-5">
          <Spinner animation="border" size="sm" /> 読み込み中...
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">マッチングルール設定</h4>
        </div>
        <div className="dl-page-header-actions d-flex gap-2 flex-wrap">
          <Link to="/admin/drug-master" className="btn btn-outline-secondary btn-sm">医薬品マスター</Link>
          <Link to="/admin/drug-equivalences" className="btn btn-outline-secondary btn-sm">薬品同等性</Link>
          <Link to="/admin/matching-experiments" className="btn btn-outline-secondary btn-sm">マッチング実験</Link>
        </div>
      </div>

      {error && <Alert variant="danger" dismissible onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert variant="success" dismissible onClose={() => setSuccess('')}>{success}</Alert>}

      {profile && (
        <div className="mb-3 text-muted small">
          プロファイル: {profile.profileName} | バージョン: {profile.version} | ソース: {profile.source}
          {profile.updatedAt && ` | 最終更新: ${new Date(profile.updatedAt).toLocaleString('ja-JP')}`}
        </div>
      )}

      <ScrollArea>
      {FIELD_GROUPS.map((group) => (
        <Card key={group.title} className="mb-3">
          <Card.Header className="fw-semibold">{group.title}</Card.Header>
          <Card.Body>
            <Row>
              {group.fields.map((field) => (
                <Col key={field.key} xs={12} md={6} lg={4} className="mb-3">
                  <Form.Group>
                    <Form.Label className="small fw-medium">{field.label}</Form.Label>
                    <Form.Control
                      type="number"
                      size="sm"
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      value={getCurrentValue(field.key)}
                      onChange={(e) => handleChange(field.key, e.target.value)}
                      disabled={saving}
                    />
                    <Form.Text className="text-muted">{field.description}</Form.Text>
                  </Form.Group>
                </Col>
              ))}
            </Row>
          </Card.Body>
        </Card>
      ))}

      <div className="d-flex gap-2 mb-4">
        <Button
          variant="primary"
          size="sm"
          onClick={() => void handleSave()}
          disabled={!hasChanges || saving}
        >
          {saving ? <><Spinner animation="border" size="sm" /> 保存中...</> : '保存'}
        </Button>
        <Button
          variant="outline-secondary"
          size="sm"
          onClick={handleReset}
          disabled={!hasChanges || saving}
        >
          リセット
        </Button>
      </div>
      </ScrollArea>
    </PageShell>
  );
}
