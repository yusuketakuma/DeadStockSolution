import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../api/client';
import type {
  RequestEventItem,
  RequestHandoffResponse,
  RequestThreadResponse,
  UserRequestItem,
  UserRequestsResponse,
} from '../../components/admin/openclaw/types';

export type OpenClawWorkflowFilter =
  'all'
  | 'queued'
  | 'analyzing'
  | 'awaiting_user'
  | 'implementing'
  | 'pr_opened'
  | 'completed'
  | 'failed';

function isNotConfiguredError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 503;
}

export function useOpenClawRequestState(params: {
  statusFilter: OpenClawWorkflowFilter;
  searchText: string;
  onError: (message: string) => void;
  onNotConfigured: (value: boolean) => void;
  onMessage: (message: string) => void;
}) {
  const { statusFilter, searchText, onError, onNotConfigured, onMessage } = params;
  const [requests, setRequests] = useState<UserRequestItem[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const [thread, setThread] = useState<RequestThreadResponse | null>(null);
  const [connectorMeta, setConnectorMeta] = useState<{
    configured: boolean;
    webhookConfigured: boolean;
    implementationBranch: string;
  } | null>(null);
  const [handoffingRequestId, setHandoffingRequestId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [events, setEvents] = useState<RequestEventItem[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  const workflowCount = requests.reduce<Record<string, number>>((acc, item) => {
    const key = item.workflowStatus ?? 'queued';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const normalizedQuery = searchText.trim().toLowerCase();
  const filteredRequests = requests.filter((item) => {
    if (statusFilter !== 'all' && item.workflowStatus !== statusFilter) {
      return false;
    }
    if (!normalizedQuery) return true;
    const haystack = `${item.pharmacyName} ${item.requestText} ${item.latestSummary ?? ''} ${item.openclawSummary ?? ''}`.toLowerCase();
    return haystack.includes(normalizedQuery);
  });

  const fetchRequests = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!background) {
      setLoading(true);
    }
    try {
      const data = await api.get<UserRequestsResponse>('/admin/requests?page=1&limit=50');
      setRequests(data.data);
      setConnectorMeta(data.connector ?? null);
      onNotConfigured(false);
      setSelectedRequestId((current) => {
        if (current && data.data.some((item) => item.id === current)) {
          return current;
        }
        return data.data[0]?.id ?? null;
      });
    } catch (err) {
      if (isNotConfiguredError(err)) {
        if (!background) onNotConfigured(true);
      } else if (!background) {
        onError(err instanceof Error ? err.message : 'OpenClaw連携情報の取得に失敗しました');
      }
    } finally {
      if (!background) {
        setLoading(false);
      }
    }
  }, [onError, onNotConfigured]);

  const fetchThread = useCallback(async (requestId: number, { background = false }: { background?: boolean } = {}) => {
    if (!background) {
      setThreadLoading(true);
    }

    try {
      const data = await api.get<RequestThreadResponse>(`/admin/requests/${requestId}/messages`);
      setThread(data);
    } catch (err) {
      if (!background) {
        onError(err instanceof Error ? err.message : '会話履歴の取得に失敗しました');
      }
    } finally {
      if (!background) {
        setThreadLoading(false);
      }
    }
  }, [onError]);

  const fetchEvents = useCallback(async (requestId: number, { background = false }: { background?: boolean } = {}) => {
    if (!background) {
      setEventsLoading(true);
    }
    try {
      const data = await api.get<{ events: RequestEventItem[] }>(`/admin/user-requests/${requestId}/events`);
      setEvents(data.events);
    } catch (err) {
      if (!background) {
        onError(err instanceof Error ? err.message : 'イベント履歴の取得に失敗しました');
      }
    } finally {
      if (!background) {
        setEventsLoading(false);
      }
    }
  }, [onError]);

  useEffect(() => {
    if (!selectedRequestId) {
      setThread(null);
      setEvents([]);
      return;
    }
    void fetchThread(selectedRequestId);
    void fetchEvents(selectedRequestId);
  }, [fetchEvents, fetchThread, selectedRequestId]);

  const handleRetryHandoff = useCallback(async (requestId: number) => {
    onError('');
    onMessage('');
    setHandoffingRequestId(requestId);
    try {
      const result = await api.post<RequestHandoffResponse>(`/admin/requests/${requestId}/handoff`);
      onMessage(`${result.message} ${result.handoff.note}`);
      await fetchRequests();
      if (selectedRequestId === requestId) {
        const threadData = await api.get<RequestThreadResponse>(`/admin/requests/${requestId}/messages`);
        setThread(threadData);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'OpenClaw再連携に失敗しました');
    } finally {
      setHandoffingRequestId(null);
    }
  }, [fetchRequests, onError, onMessage, selectedRequestId]);

  return {
    connectorMeta,
    requests,
    filteredRequests,
    workflowCount,
    loading,
    selectedRequestId,
    setSelectedRequestId,
    thread,
    threadLoading,
    events,
    eventsLoading,
    handoffingRequestId,
    fetchRequests,
    fetchThread,
    fetchEvents,
    handleRetryHandoff,
  };
}
