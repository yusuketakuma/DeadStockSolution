import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../api/client';
import type {
  BootstrapTokenResponse,
  DdsAgentStatus,
  OpenClawHealthSnapshot,
  OpenClawRetryItem,
  OpenClawRetryResponse,
} from '../../components/admin/openclaw/types';

export type OpenClawRetryFilter = 'all' | 'pending' | 'processing' | 'completed' | 'failed';

function isNotConfiguredError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 503;
}

export function useOpenClawRuntimeState(params: {
  retryStatusFilter: OpenClawRetryFilter;
  onError: (message: string) => void;
  onNotConfigured: (value: boolean) => void;
  onMessage: (message: string) => void;
}) {
  const { retryStatusFilter, onError, onNotConfigured, onMessage } = params;
  const [retryItems, setRetryItems] = useState<OpenClawRetryItem[]>([]);
  const [retryStats, setRetryStats] = useState<OpenClawRetryResponse['stats'] | null>(null);
  const [retryLoading, setRetryLoading] = useState(false);
  const [health, setHealth] = useState<OpenClawHealthSnapshot | null>(null);
  const [ddsStatus, setDdsStatus] = useState<DdsAgentStatus | null>(null);
  const [bootstrapToken, setBootstrapToken] = useState<BootstrapTokenResponse['data'] | null>(null);
  const [issuingBootstrapToken, setIssuingBootstrapToken] = useState(false);
  const [rotatingControlToken, setRotatingControlToken] = useState(false);

  const fetchRetryQueue = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!background) {
      setRetryLoading(true);
    }
    try {
      const suffix = retryStatusFilter === 'all' ? '' : `&status=${retryStatusFilter}`;
      const data = await api.get<OpenClawRetryResponse>(`/admin/openclaw-retries?page=1&limit=20${suffix}`);
      setRetryItems(data.data);
      setRetryStats(data.stats ?? null);
    } catch (err) {
      if (!background && !isNotConfiguredError(err)) {
        onError(err instanceof Error ? err.message : 'リトライキューの取得に失敗しました');
      }
    } finally {
      if (!background) {
        setRetryLoading(false);
      }
    }
  }, [onError, retryStatusFilter]);

  const fetchHealth = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    try {
      const [healthData, ddsData] = await Promise.all([
        api.get<OpenClawHealthSnapshot>('/health/openclaw'),
        api.get<{ data: DdsAgentStatus }>('/admin/openclaw/dds-agent'),
      ]);
      setHealth(healthData);
      setDdsStatus(ddsData.data);
      onNotConfigured(false);
    } catch (err) {
      if (isNotConfiguredError(err)) {
        if (!background) onNotConfigured(true);
      } else if (!background) {
        onError(err instanceof Error ? err.message : 'OpenClawヘルス情報の取得に失敗しました');
      }
    }
  }, [onError, onNotConfigured]);

  useEffect(() => {
    void fetchRetryQueue();
  }, [fetchRetryQueue]);

  const handleIssueBootstrapToken = useCallback(async () => {
    setIssuingBootstrapToken(true);
    onError('');
    try {
      const result = await api.post<BootstrapTokenResponse>('/admin/openclaw/bootstrap-token', {});
      setBootstrapToken(result.data);
      onMessage('DDS bootstrap token を発行しました');
      await fetchHealth({ background: true });
    } catch (err) {
      onError(err instanceof Error ? err.message : 'bootstrap token の発行に失敗しました');
    } finally {
      setIssuingBootstrapToken(false);
    }
  }, [fetchHealth, onError, onMessage]);

  const handleRotateControlToken = useCallback(async () => {
    setRotatingControlToken(true);
    onError('');
    try {
      const result = await api.post<{ message: string }>('/admin/openclaw/control-token/rotate', {});
      onMessage(result.message);
      await fetchHealth({ background: true });
    } catch (err) {
      onError(err instanceof Error ? err.message : 'control token のローテーションに失敗しました');
    } finally {
      setRotatingControlToken(false);
    }
  }, [fetchHealth, onError, onMessage]);

  return {
    retryItems,
    retryStats,
    retryLoading,
    health,
    ddsStatus,
    bootstrapToken,
    issuingBootstrapToken,
    rotatingControlToken,
    fetchRetryQueue,
    fetchHealth,
    handleIssueBootstrapToken,
    handleRotateControlToken,
  };
}
