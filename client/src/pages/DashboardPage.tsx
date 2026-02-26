import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationContext';
import { api } from '../api/client';
import {
  UploadStatus,
  NotificationsResponse,
  Notice,
  buildNextAction,
  resolveNoticeReadEndpoint,
} from '../components/dashboard/types';
import { sanitizeInternalPath } from '../utils/navigation';
import DashboardNextAction from '../components/dashboard/DashboardNextAction';
import DashboardNotices from '../components/dashboard/DashboardNotices';
import DashboardStatusCards from '../components/dashboard/DashboardStatusCards';
import { useAsyncResource } from '../hooks/useAsyncResource';
import AppDataPanel from '../components/ui/AppDataPanel';
import AppKpiCard from '../components/ui/AppKpiCard';

interface DashboardData {
  status: UploadStatus | null;
  notifications: NotificationsResponse | null;
  risk: PharmacyRisk | null;
  partialError: string;
}

interface PharmacyRisk {
  totalItems: number;
  riskScore: number;
  bucketCounts: {
    expired: number;
    within30: number;
    within60: number;
    within90: number;
    within120: number;
    over120: number;
    unknown: number;
  };
  computedAt: string;
}

function isValidRisk(value: unknown): value is PharmacyRisk {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.riskScore === 'number'
    && typeof row.totalItems === 'number'
    && row.bucketCounts !== null
    && typeof row.bucketCounts === 'object';
}

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { refreshCount } = useNotifications();
  const [status, setStatus] = useState<UploadStatus | null>(null);
  const [notifications, setNotifications] = useState<NotificationsResponse | null>(null);
  const [risk, setRisk] = useState<PharmacyRisk | null>(null);
  const [dashboardError, setDashboardError] = useState('');

  const fetchDashboardData = useCallback(async (_signal: AbortSignal) => {
    const [nextStatus, nextNotifications, nextRisk] = await Promise.allSettled([
      api.get<UploadStatus>('/upload/status', { signal: _signal }),
      api.get<NotificationsResponse>('/notifications', { signal: _signal }),
      api.get<PharmacyRisk>('/inventory/dead-stock/risk', { signal: _signal }),
    ]);

    if (nextStatus.status === 'rejected' && nextNotifications.status === 'rejected' && nextRisk.status === 'rejected') {
      throw new Error('ダッシュボードデータの取得に失敗しました');
    }

    const errors: string[] = [];
    if (nextStatus.status === 'rejected') {
      errors.push('アップロード状況の取得に失敗しました。');
    }
    if (nextNotifications.status === 'rejected') {
      errors.push('通知の取得に失敗しました。');
    }
    if (nextRisk.status === 'rejected') {
      errors.push('期限リスクの取得に失敗しました。');
    }

    return {
      status: nextStatus.status === 'fulfilled' ? nextStatus.value : null,
      notifications: nextNotifications.status === 'fulfilled' ? nextNotifications.value : null,
      risk: nextRisk.status === 'fulfilled' && isValidRisk(nextRisk.value) ? nextRisk.value : null,
      partialError: errors.join(' ').trim(),
    };
  }, []);
  const { data, loading, error, reload } = useAsyncResource<DashboardData>(fetchDashboardData);

  useEffect(() => {
    if (!data) return;
    if (data.status) setStatus(data.status);
    if (data.notifications) setNotifications(data.notifications);
    if (data.risk && isValidRisk(data.risk)) setRisk(data.risk);
    setDashboardError(data.partialError);
  }, [data]);

  const nextAction = useMemo(() => buildNextAction(status, notifications), [status, notifications]);

  const handleNoticeClick = async (notice: Notice) => {
    const readEndpoint = resolveNoticeReadEndpoint(notice);
    if (readEndpoint) {
      try {
        await api.post(readEndpoint);
        setNotifications((prev) => {
          if (!prev) return prev;
          const nextNotices = prev.notices.map((item) => (
            item.id === notice.id ? { ...item, unread: false } : item
          ));
          return {
            ...prev,
            notices: nextNotices,
            summary: {
              ...prev.summary,
              unreadMessages: nextNotices.filter((item) => item.type === 'admin_message' && item.unread).length,
              actionableRequests: nextNotices.filter((item) =>
                item.unread && (item.type === 'inbound_request' || item.type === 'status_update' || item.type === 'match_update')
              ).length,
            },
          };
        });
        void reload();
        void refreshCount();
      } catch (err) {
        console.error('Failed to mark notification as read', err);
      }
    }

    const safeActionPath = sanitizeInternalPath(notice.actionPath, '');
    if (safeActionPath) {
      navigate(safeActionPath);
      return;
    }

    await reload();
  };

  return (
    <div>
      <h4 className="page-title mb-3">ダッシュボード</h4>

      <DashboardNotices
        notifications={notifications}
        loadingNotifications={loading}
        dashboardError={error || dashboardError}
        onNoticeClick={handleNoticeClick}
        onRetry={() => { void reload(); }}
        onRefresh={() => { void reload(); }}
      />

      <DashboardNextAction nextAction={nextAction} />

      <AppDataPanel title="期限切れリスク（自薬局）" className="mb-3">
        {risk ? (
          <div className="row g-3">
            <div className="col-md-3">
              <AppKpiCard value={risk.riskScore.toFixed(1)} label="リスクスコア" />
            </div>
            <div className="col-md-3">
              <AppKpiCard value={risk.bucketCounts.expired} label="期限切れ件数" />
            </div>
            <div className="col-md-3">
              <AppKpiCard value={risk.bucketCounts.within30} label="30日以内件数" />
            </div>
            <div className="col-md-3">
              <AppKpiCard value={risk.totalItems} label="対象在庫件数" />
            </div>
          </div>
        ) : (
          <div className="small text-muted">期限リスクデータはまだありません。</div>
        )}
      </AppDataPanel>

      <DashboardStatusCards status={status} userName={user?.name} />
    </div>
  );
}
