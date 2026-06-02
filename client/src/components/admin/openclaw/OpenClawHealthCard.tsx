import { Badge } from 'react-bootstrap';
import AppCard from '../../ui/AppCard';
import AppDropdownMenu from '../../ui/AppDropdownMenu';
import AppMobileDataCard from '../../ui/AppMobileDataCard';
import LoadingButton from '../../ui/LoadingButton';
import { formatDateTimeJa } from '../../../utils/formatters';
import type { OpenClawHealthSnapshot, DdsAgentStatus, BootstrapTokenResponse } from './types';

interface OpenClawHealthCardProps {
  health: OpenClawHealthSnapshot | null;
  ddsStatus: DdsAgentStatus | null;
  bootstrapToken: BootstrapTokenResponse['data'] | null;
  issuingBootstrapToken: boolean;
  rotatingControlToken: boolean;
  onIssueBootstrapToken: () => void;
  onRotateControlToken: () => void;
}

/** DDS / OpenClaw ヘルス表示カード */
export default function OpenClawHealthCard({
  health,
  ddsStatus,
  bootstrapToken,
  issuingBootstrapToken,
  rotatingControlToken,
  onIssueBootstrapToken,
  onRotateControlToken,
}: OpenClawHealthCardProps) {
  const handleCopyBootstrapToken = () => {
    const writeText = navigator.clipboard?.writeText;
    if (!bootstrapToken?.token || typeof writeText !== 'function') {
      return;
    }

    void writeText.call(navigator.clipboard, bootstrapToken.token).catch(() => {});
  };

  return (
    <AppCard className="mb-3">
      <AppCard.Header>DDS / OpenClaw ヘルス</AppCard.Header>
      <AppCard.Body>
        <div className="dl-badge-row mb-3">
          <Badge bg={health?.status === 'ok' ? 'success' : 'warning'}>{health?.status === 'ok' ? '稼働中' : '要確認'}</Badge>
          <Badge bg={health?.connector.configured ? 'success' : 'secondary'}>Connector {health?.connector.configured ? '接続済み' : '未接続'}</Badge>
          <Badge bg={health?.webhook.configured ? 'success' : 'secondary'}>Webhook {health?.webhook.configured ? '設定済み' : '未設定'}</Badge>
          <Badge bg={ddsStatus?.connected ? 'success' : 'secondary'}>DDS {ddsStatus?.connected ? '接続中' : '未接続'}</Badge>
        </div>
        <div className="small text-muted mb-3">
          最終 handoff: {formatDateTimeJa(health?.lastHandoffAt)} / 成功率: {health?.handoffSuccessRate != null ? `${Math.round(health.handoffSuccessRate * 100)}%` : '-'}
        </div>
        <div className="row g-2 mb-3">
          <div className="col-md-3 col-6"><AppMobileDataCard title="保留ジョブ" fields={[{ label: 'pending', value: health?.retryQueue.pending ?? 0 }, { label: 'processing', value: health?.retryQueue.processing ?? 0 }]} /></div>
          <div className="col-md-3 col-6"><AppMobileDataCard title="DDS状態" fields={[{ label: 'agentId', value: ddsStatus?.agentId ?? '-' }, { label: 'lastSeen', value: formatDateTimeJa(ddsStatus?.lastSeenAt) }]} /></div>
          <div className="col-md-3 col-6"><AppMobileDataCard title="待機ジョブ" fields={[{ label: 'queued', value: ddsStatus?.queuedJobs ?? 0 }, { label: 'awaiting', value: ddsStatus?.awaitingUser ?? 0 }]} /></div>
          <div className="col-md-3 col-6"><AppMobileDataCard title="feature flags" fields={[{ label: 'commands', value: health?.commands.enabled ? 'ON' : 'OFF' }, { label: 'autoFix', value: health?.autoFix.enabled ? 'ON' : 'OFF' }]} /></div>
        </div>
        <div className="dl-action-row mobile-stack">
          <LoadingButton
            size="sm"
            variant="primary"
            onClick={onIssueBootstrapToken}
            loading={issuingBootstrapToken}
            loadingLabel="発行中..."
          >
            bootstrap token 発行
          </LoadingButton>
          <AppDropdownMenu
            label="その他"
            variant="outline-secondary"
            items={[
              {
                key: 'rotate-control-token',
                label: rotatingControlToken ? '更新中...' : 'control token ローテーション',
                onClick: onRotateControlToken,
                disabled: rotatingControlToken,
              },
            ]}
          />
        </div>
        {bootstrapToken ? (
          <div className="mt-3 small">
            <div className="fw-semibold">最新 bootstrap token</div>
            <div className="text-break d-flex align-items-center gap-2">
              <code>{bootstrapToken.token.slice(0, 8)}...{bootstrapToken.token.slice(-4)}</code>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary py-0 px-1"
                onClick={handleCopyBootstrapToken}
              >
                コピー
              </button>
            </div>
            <div className="text-muted">有効期限: {formatDateTimeJa(bootstrapToken.expiresAt)}</div>
            <div className="text-muted text-break">register: {bootstrapToken.registerUrl}</div>
            <div className="text-muted text-break">health: {bootstrapToken.healthUrl}</div>
          </div>
        ) : null}
      </AppCard.Body>
    </AppCard>
  );
}
