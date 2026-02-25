import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import {
  UploadStatus,
  NotificationsResponse,
  Notice,
  buildNextAction,
  parseMessageId,
} from '../components/dashboard/types';
import DashboardNextAction from '../components/dashboard/DashboardNextAction';
import DashboardNotices from '../components/dashboard/DashboardNotices';
import DashboardStatusCards from '../components/dashboard/DashboardStatusCards';

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<UploadStatus | null>(null);
  const [notifications, setNotifications] = useState<NotificationsResponse | null>(null);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [dashboardError, setDashboardError] = useState('');
  const nextAction = buildNextAction(status, notifications);

  const fetchDashboardData = async () => {
    setLoadingNotifications(true);
    setDashboardError('');
    try {
      const [statusData, noticesData] = await Promise.all([
        api.get<UploadStatus>('/upload/status'),
        api.get<NotificationsResponse>('/notifications'),
      ]);
      setStatus(statusData);
      setNotifications(noticesData);
    } catch (err) {
      setDashboardError(err instanceof Error ? err.message : 'ダッシュボード情報の取得に失敗しました');
    } finally {
      setLoadingNotifications(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const handleNoticeClick = async (notice: Notice) => {
    const messageId = parseMessageId(notice.id);
    if (notice.type === 'admin_message' && notice.unread && messageId) {
      try {
        await api.post(`/notifications/messages/${messageId}/read`);
      } catch {
        // ignore
      }
    }

    if (notice.actionPath) {
      navigate(notice.actionPath);
      return;
    }

    fetchDashboardData();
  };

  return (
    <div>
      <h4 className="page-title mb-3">ダッシュボード</h4>

      <DashboardNextAction nextAction={nextAction} />

      <DashboardNotices
        notifications={notifications}
        loadingNotifications={loadingNotifications}
        dashboardError={dashboardError}
        onNoticeClick={handleNoticeClick}
        onRetry={fetchDashboardData}
      />

      <DashboardStatusCards status={status} userName={user?.name} />
    </div>
  );
}
