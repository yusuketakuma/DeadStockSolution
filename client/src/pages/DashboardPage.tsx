import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import {
  UploadStatus,
  NotificationsResponse,
  Notice,
  buildNextAction,
  resolveNoticeReadEndpoint,
} from '../components/dashboard/types';
import DashboardNextAction from '../components/dashboard/DashboardNextAction';
import DashboardNotices from '../components/dashboard/DashboardNotices';
import DashboardStatusCards from '../components/dashboard/DashboardStatusCards';
import { useAsyncResource } from '../hooks/useAsyncResource';

interface DashboardData {
  status: UploadStatus | null;
  notifications: NotificationsResponse | null;
  partialError: string;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<UploadStatus | null>(null);
  const [notifications, setNotifications] = useState<NotificationsResponse | null>(null);
  const [dashboardError, setDashboardError] = useState('');

  const fetchDashboardData = useCallback(async (_signal: AbortSignal) => {
    const [nextStatus, nextNotifications] = await Promise.allSettled([
      api.get<UploadStatus>('/upload/status'),
      api.get<NotificationsResponse>('/notifications'),
    ]);

    if (nextStatus.status === 'rejected' && nextNotifications.status === 'rejected') {
      throw new Error('ダッシュボードデータの取得に失敗しました');
    }

    const errors: string[] = [];
    if (nextStatus.status === 'rejected') {
      errors.push('アップロード状況の取得に失敗しました。');
    }
    if (nextNotifications.status === 'rejected') {
      errors.push('通知の取得に失敗しました。');
    }

    return {
      status: nextStatus.status === 'fulfilled' ? nextStatus.value : null,
      notifications: nextNotifications.status === 'fulfilled' ? nextNotifications.value : null,
      partialError: errors.join(' ').trim(),
    };
  }, []);
  const { data, loading, error, reload } = useAsyncResource<DashboardData>(fetchDashboardData);

  useEffect(() => {
    if (!data) return;
    if (data.status) setStatus(data.status);
    if (data.notifications) setNotifications(data.notifications);
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
      } catch (err) {
        console.error('Failed to mark notification as read', err);
      }
    }

    if (notice.actionPath) {
      navigate(notice.actionPath);
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

      <DashboardStatusCards status={status} userName={user?.name} />
    </div>
  );
}
