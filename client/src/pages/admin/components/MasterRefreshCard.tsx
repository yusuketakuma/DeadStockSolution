import { Badge, Form } from 'react-bootstrap';
import AppAlert from '../../../components/ui/AppAlert';
import AppCard from '../../../components/ui/AppCard';
import LoadingButton from '../../../components/ui/LoadingButton';
import { formatDateTimeJa } from '../../../utils/formatters';

interface RefreshStep {
  key: string;
  label: string;
  status: 'idle' | 'running' | 'success' | 'failed';
  sourceDescription: string | null;
  message: string;
  startedAt: string | null;
  completedAt: string | null;
}

interface AutoSyncStatus {
  enabled: boolean;
  sourceHost: string;
  hasSourceUrl: boolean;
  checkIntervalHours: number;
  sourceMode?: 'index' | 'single';
}

interface MasterRefreshCardProps {
  refreshing: boolean;
  active: boolean;
  message: string;
  error: string;
  autoSyncStatus: AutoSyncStatus | null;
  packageAutoSyncStatus: AutoSyncStatus | null;
  steps: RefreshStep[];
  onRefresh: () => void;
}

function getStatusBadge(status: RefreshStep['status']): { variant: string; label: string } {
  switch (status) {
    case 'running':
      return { variant: 'primary', label: '更新中' };
    case 'success':
      return { variant: 'success', label: '完了' };
    case 'failed':
      return { variant: 'danger', label: '失敗' };
    default:
      return { variant: 'secondary', label: '待機中' };
  }
}

function renderSourceSummary(
  autoSyncStatus: AutoSyncStatus | null,
  packageAutoSyncStatus: AutoSyncStatus | null,
): string {
  const drugSource = autoSyncStatus?.sourceMode === 'index'
    ? 'MHLWポータル自動探索'
    : (autoSyncStatus?.sourceHost || '未設定');
  const packageSource = packageAutoSyncStatus?.sourceHost || '未設定';
  return `医薬品本体: ${drugSource} / 包装単位: ${packageSource}`;
}

export default function MasterRefreshCard({
  refreshing,
  active,
  message,
  error,
  autoSyncStatus,
  packageAutoSyncStatus,
  steps,
  onRefresh,
}: MasterRefreshCardProps) {
  return (
    <AppCard className="mb-3">
      <AppCard.Header>マスター更新</AppCard.Header>
      <AppCard.Body>
        <p className="small text-muted mb-2">
          1回の実行で医薬品マスター本体と包装単位データをまとめて更新します。
        </p>
        <LoadingButton
          size="sm"
          onClick={onRefresh}
          loading={refreshing}
          loadingLabel="更新開始中..."
        >
          マスター更新
        </LoadingButton>
        <Form.Text className="d-block mt-1 text-muted">
          {renderSourceSummary(autoSyncStatus, packageAutoSyncStatus)}
        </Form.Text>
        {active && (
          <Form.Text className="d-block mt-1 text-primary">
            更新中は2秒ごとに進捗と更新ログを自動更新します。
          </Form.Text>
        )}
        {message && <AppAlert variant="success" className="py-1 small mt-2">{message}</AppAlert>}
        {error && <AppAlert variant="danger" className="py-1 small mt-2">{error}</AppAlert>}

        <div className="mt-3">
          {steps.map((step) => {
            const badge = getStatusBadge(step.status);
            return (
              <div key={step.key} className="border rounded px-3 py-2 mb-2">
                <div className="d-flex align-items-center justify-content-between gap-2 mb-1">
                  <div className="fw-semibold small">{step.label}</div>
                  <Badge bg={badge.variant}>{badge.label}</Badge>
                </div>
                <div className="small text-muted">{step.message}</div>
                {step.sourceDescription && (
                  <div className="small text-muted mt-1">対象: {step.sourceDescription}</div>
                )}
                <div className="small text-muted mt-1">
                  開始: {formatDateTimeJa(step.startedAt)}
                  {step.completedAt ? ` / 完了: ${formatDateTimeJa(step.completedAt)}` : ''}
                </div>
              </div>
            );
          })}
        </div>
      </AppCard.Body>
    </AppCard>
  );
}
