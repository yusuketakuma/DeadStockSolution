import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Badge, Col, Form, Row } from 'react-bootstrap';
import { api } from '../../api/client';
import AppDataPanel from '../../components/ui/AppDataPanel';
import AppEmptyState from '../../components/ui/AppEmptyState';
import AppMobileDataCard from '../../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../../components/ui/AppResponsiveSwitch';
import AppTable from '../../components/ui/AppTable';
import AppDropdownMenu from '../../components/ui/AppDropdownMenu';
import InlineLoader from '../../components/ui/InlineLoader';
import LoadingButton from '../../components/ui/LoadingButton';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';
import { formatDateTimeJa } from '../../utils/formatters';

type ExperimentStatus = 'draft' | 'running' | 'completed' | 'cancelled';

interface MatchingExperiment {
  id: number;
  name: string;
  controlProfileId: number;
  treatmentProfileId: number;
  trafficPercentage: number;
  status: ExperimentStatus;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string | null;
}

interface ExperimentResults {
  experimentId: number;
  totalAssignments: number;
  controlCount: number;
  treatmentCount: number;
}

function getStatusBadgeVariant(status: ExperimentStatus): 'secondary' | 'success' | 'dark' | 'warning' {
  if (status === 'running') return 'success';
  if (status === 'completed') return 'dark';
  if (status === 'cancelled') return 'warning';
  return 'secondary';
}

function getStatusLabel(status: ExperimentStatus): string {
  if (status === 'running') return '実行中';
  if (status === 'completed') return '完了';
  if (status === 'cancelled') return '中止';
  return '下書き';
}

export default function AdminMatchingExperimentsPage() {
  const [experiments, setExperiments] = useState<MatchingExperiment[]>([]);
  const [selectedExperimentId, setSelectedExperimentId] = useState<number | null>(null);
  const [results, setResults] = useState<ExperimentResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [controlProfileId, setControlProfileId] = useState('');
  const [treatmentProfileId, setTreatmentProfileId] = useState('');
  const [trafficPercentage, setTrafficPercentage] = useState('50');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadExperiments = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get<{ experiments: MatchingExperiment[] }>('/admin/matching-experiments');
      setExperiments(response.experiments);
      setSelectedExperimentId((current) => {
        if (current && response.experiments.some((experiment) => experiment.id === current)) {
          return current;
        }
        return response.experiments.find((experiment) => experiment.status === 'running')?.id
          ?? response.experiments[0]?.id
          ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '実験一覧の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadResults = useCallback(async (experimentId: number) => {
    setResultsLoading(true);
    try {
      const response = await api.get<{ results: ExperimentResults }>(`/admin/matching-experiments/${experimentId}/results`);
      setResults(response.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : '実験結果の取得に失敗しました');
      setResults(null);
    } finally {
      setResultsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadExperiments();
  }, [loadExperiments]);

  useEffect(() => {
    if (!selectedExperimentId) {
      setResults(null);
      return;
    }
    void loadResults(selectedExperimentId);
  }, [loadResults, selectedExperimentId]);

  const selectedExperiment = useMemo(
    () => experiments.find((experiment) => experiment.id === selectedExperimentId) ?? null,
    [experiments, selectedExperimentId],
  );

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setError('');
    setMessage('');
    try {
      const response = await api.post<{ experiment: MatchingExperiment }>('/admin/matching-experiments', {
        name: name.trim(),
        controlProfileId: Number(controlProfileId),
        treatmentProfileId: Number(treatmentProfileId),
        trafficPercentage: Number(trafficPercentage),
      });
      setMessage('マッチング実験を作成しました');
      setName('');
      setControlProfileId('');
      setTreatmentProfileId('');
      setTrafficPercentage('50');
      setSelectedExperimentId(response.experiment.id);
      await loadExperiments();
    } catch (err) {
      setError(err instanceof Error ? err.message : '実験の作成に失敗しました');
    } finally {
      setCreating(false);
    }
  };

  const handleStateChange = async (experimentId: number, action: 'start' | 'stop') => {
    const nextActionKey = `${action}:${experimentId}`;
    setActionKey(nextActionKey);
    setError('');
    setMessage('');
    try {
      const path = action === 'start'
        ? `/admin/matching-experiments/${experimentId}/start`
        : `/admin/matching-experiments/${experimentId}/stop`;
      await api.patch<{ experiment: MatchingExperiment }>(path);
      setMessage(action === 'start' ? '実験を開始しました' : '実験を停止しました');
      await loadExperiments();
      await loadResults(experimentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '実験状態の更新に失敗しました');
    } finally {
      setActionKey(null);
    }
  };

  return (
    <PageShell>
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">マッチング実験</h4>
          <small className="text-muted">control / treatment の割当状況を確認し、実験を開始・停止できます。</small>
        </div>
        <div className="dl-action-row mobile-stack">
          <Link to="/admin/matching-rules" className="btn btn-outline-primary btn-sm">マッチングルール</Link>
          <AppDropdownMenu
            label="関連"
            size="sm"
            variant="outline-secondary"
            items={[
              { label: '管理ダッシュボード', to: '/admin' },
              { label: 'マッチング性能', to: '/admin/matching-performance' },
            ]}
          />
        </div>
      </div>

      {message && <Alert variant="success" dismissible onClose={() => setMessage('')}>{message}</Alert>}
      {error && <Alert variant="danger" dismissible onClose={() => setError('')}>{error}</Alert>}

      <ScrollArea>
        <AppDataPanel title="関連運用" className="mb-3">
          <div className="dl-action-row mobile-stack">
            <Link to="/admin/notifications" className="btn btn-outline-primary btn-sm">通知・配信状況</Link>
            <AppDropdownMenu
              label="関連"
              size="sm"
              variant="outline-secondary"
              items={[
                { label: 'アップロード品質', to: '/admin/upload-quality' },
                { label: 'エラーコード', to: '/admin/error-codes' },
                { label: 'ログセンター', to: '/admin/log-center' },
              ]}
            />
          </div>
          <div className="small text-muted mt-2">
            実験結果の確認後に、通知影響と関連エラーの有無まで一段でたどれます。
          </div>
        </AppDataPanel>

        <AppDataPanel title="新しい実験を作成" className="mb-3">
          <div className="small text-muted mb-3">
            プロファイル ID は「マッチングルール」画面の運用情報と対応づけて入力してください。
          </div>
          <Form onSubmit={(event) => { void handleCreate(event); }}>
            <Row className="g-2 align-items-end">
              <Col md={4}>
                <Form.Label className="small">実験名</Form.Label>
                <Form.Control size="sm" value={name} onChange={(event) => setName(event.target.value)} />
              </Col>
              <Col md={2}>
                <Form.Label className="small">Control ID</Form.Label>
                <Form.Control size="sm" type="number" min="1" value={controlProfileId} onChange={(event) => setControlProfileId(event.target.value)} />
              </Col>
              <Col md={2}>
                <Form.Label className="small">Treatment ID</Form.Label>
                <Form.Control size="sm" type="number" min="1" value={treatmentProfileId} onChange={(event) => setTreatmentProfileId(event.target.value)} />
              </Col>
              <Col md={2}>
                <Form.Label className="small">Traffic %</Form.Label>
                <Form.Control size="sm" type="number" min="0" max="100" value={trafficPercentage} onChange={(event) => setTrafficPercentage(event.target.value)} />
              </Col>
              <Col md={2}>
                <LoadingButton
                  type="submit"
                  variant="primary"
                  size="sm"
                  className="w-100"
                  loading={creating}
                  loadingLabel="作成中..."
                >
                  実験を作成
                </LoadingButton>
              </Col>
            </Row>
          </Form>
        </AppDataPanel>

        <Row className="g-3">
          <Col lg={8}>
            <AppDataPanel title="実験一覧" className="mb-3">
              {loading ? (
                <InlineLoader text="実験一覧を読み込み中..." className="text-muted small" />
              ) : experiments.length === 0 ? (
                <AppEmptyState
                  title="登録済みの実験はありません"
                  description="まずは control / treatment の組み合わせを登録してください。"
                  icon={null}
                />
              ) : (
                <AppResponsiveSwitch
                  desktop={() => (
                    <div className="table-responsive">
                      <AppTable striped hover className="mobile-table">
                        <thead className="table-light">
                          <tr>
                            <th>実験</th>
                            <th>Control / Treatment</th>
                            <th>Traffic</th>
                            <th>状態</th>
                            <th>作成日</th>
                            <th>操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {experiments.map((experiment) => (
                            <tr key={experiment.id}>
                              <td>
                                <button type="button" className="btn btn-link btn-sm p-0" onClick={() => setSelectedExperimentId(experiment.id)}>
                                  {experiment.name}
                                </button>
                              </td>
                              <td>{experiment.controlProfileId} / {experiment.treatmentProfileId}</td>
                              <td>{experiment.trafficPercentage}%</td>
                              <td><Badge bg={getStatusBadgeVariant(experiment.status)}>{getStatusLabel(experiment.status)}</Badge></td>
                              <td>{formatDateTimeJa(experiment.createdAt)}</td>
                              <td className="d-flex gap-2">
                                {experiment.status === 'draft' ? (
                                  <LoadingButton
                                    size="sm"
                                    variant="outline-primary"
                                    loading={actionKey === `start:${experiment.id}`}
                                    loadingLabel="開始中..."
                                    onClick={() => { void handleStateChange(experiment.id, 'start'); }}
                                  >
                                    開始
                                  </LoadingButton>
                                ) : null}
                                {experiment.status === 'running' ? (
                                  <LoadingButton
                                    size="sm"
                                    variant="outline-secondary"
                                    loading={actionKey === `stop:${experiment.id}`}
                                    loadingLabel="停止中..."
                                    onClick={() => { void handleStateChange(experiment.id, 'stop'); }}
                                  >
                                    停止
                                  </LoadingButton>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </AppTable>
                    </div>
                  )}
                  mobile={() => (
                    <div className="dl-mobile-data-list">
                      {experiments.map((experiment) => (
                        <AppMobileDataCard
                          key={experiment.id}
                          title={experiment.name}
                          subtitle={`Control ${experiment.controlProfileId} / Treatment ${experiment.treatmentProfileId}`}
                          badges={<Badge bg={getStatusBadgeVariant(experiment.status)}>{getStatusLabel(experiment.status)}</Badge>}
                          fields={[
                            { label: 'Traffic', value: `${experiment.trafficPercentage}%` },
                            { label: '作成日', value: formatDateTimeJa(experiment.createdAt) },
                          ]}
                          actions={(
                            <div className="d-flex gap-2">
                              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setSelectedExperimentId(experiment.id)}>
                                結果を見る
                              </button>
                              {experiment.status === 'draft' ? (
                                <LoadingButton
                                  size="sm"
                                  variant="outline-primary"
                                  loading={actionKey === `start:${experiment.id}`}
                                  loadingLabel="開始中..."
                                  onClick={() => { void handleStateChange(experiment.id, 'start'); }}
                                >
                                  開始
                                </LoadingButton>
                              ) : null}
                              {experiment.status === 'running' ? (
                                <LoadingButton
                                  size="sm"
                                  variant="outline-secondary"
                                  loading={actionKey === `stop:${experiment.id}`}
                                  loadingLabel="停止中..."
                                  onClick={() => { void handleStateChange(experiment.id, 'stop'); }}
                                >
                                  停止
                                </LoadingButton>
                              ) : null}
                            </div>
                          )}
                        />
                      ))}
                    </div>
                  )}
                />
              )}
            </AppDataPanel>
          </Col>
          <Col lg={4}>
            <AppDataPanel title="割当サマリー" className="mb-3">
              {selectedExperiment ? (
                resultsLoading ? (
                  <InlineLoader text="実験結果を読み込み中..." className="text-muted small" />
                ) : results ? (
                  <div className="d-flex flex-column gap-3">
                    <div>
                      <div className="fw-semibold">{selectedExperiment.name}</div>
                      <div className="small text-muted">状態: {getStatusLabel(selectedExperiment.status)}</div>
                    </div>
                    <Row className="g-2 text-center">
                      <Col xs={4}>
                        <div className="border rounded py-2">
                          <div className="small text-muted">総割当</div>
                          <div className="fw-semibold">{results.totalAssignments}</div>
                        </div>
                      </Col>
                      <Col xs={4}>
                        <div className="border rounded py-2">
                          <div className="small text-muted">Control</div>
                          <div className="fw-semibold">{results.controlCount}</div>
                        </div>
                      </Col>
                      <Col xs={4}>
                        <div className="border rounded py-2">
                          <div className="small text-muted">Treatment</div>
                          <div className="fw-semibold">{results.treatmentCount}</div>
                        </div>
                      </Col>
                    </Row>
                    <div className="small text-muted">
                      実行開始: {formatDateTimeJa(selectedExperiment.startedAt)}
                    </div>
                  </div>
                ) : (
                  <div className="text-muted small">選択した実験の結果はまだありません。</div>
                )
              ) : (
                <div className="text-muted small">実験を選択すると割当サマリーを表示します。</div>
              )}
            </AppDataPanel>
          </Col>
        </Row>
      </ScrollArea>
    </PageShell>
  );
}
