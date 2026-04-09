import { useEffect, useState } from 'react';
import { useSseRefresh } from '../../hooks/useSseRefresh';
import { useOpenClawRequestState, type OpenClawWorkflowFilter } from './useOpenClawRequestState';
import { useOpenClawRuntimeState, type OpenClawRetryFilter } from './useOpenClawRuntimeState';

const LIVE_REFRESH_INTERVAL_MS = 60_000;

export function useAdminOpenClawData() {
  const [statusFilter, setStatusFilter] = useState<OpenClawWorkflowFilter>('all');
  const [retryStatusFilter, setRetryStatusFilter] = useState<OpenClawRetryFilter>('all');
  const [searchText, setSearchText] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [notConfigured, setNotConfigured] = useState(false);

  const requestState = useOpenClawRequestState({
    statusFilter,
    searchText,
    onError: setError,
    onNotConfigured: setNotConfigured,
    onMessage: setMessage,
  });

  const runtimeState = useOpenClawRuntimeState({
    retryStatusFilter,
    onError: setError,
    onNotConfigured: setNotConfigured,
    onMessage: setMessage,
  });

  const {
    fetchRequests,
    fetchThread,
    fetchEvents,
    selectedRequestId,
  } = requestState;
  const {
    fetchRetryQueue,
    fetchHealth,
  } = runtimeState;

  useEffect(() => {
    void fetchRequests();
    void fetchRetryQueue();
    void fetchHealth();
  }, [fetchHealth, fetchRequests, fetchRetryQueue]);

  useSseRefresh({
    enabled: true,
    streamPath: '/realtime/stream?topics=admin_requests',
    events: ['admin_requests.refresh'],
    onRefresh: async () => {
      await fetchRequests({ background: true });
      await fetchRetryQueue({ background: true });
      await fetchHealth({ background: true });
      if (selectedRequestId) {
        await fetchThread(selectedRequestId, { background: true });
        await fetchEvents(selectedRequestId, { background: true });
      }
    },
    fallbackIntervalMs: LIVE_REFRESH_INTERVAL_MS,
    minFetchIntervalMs: 4_000,
  });

  return {
    connectorMeta: requestState.connectorMeta,
    requests: requestState.requests,
    filteredRequests: requestState.filteredRequests,
    workflowCount: requestState.workflowCount,
    loading: requestState.loading,
    selectedRequestId: requestState.selectedRequestId,
    thread: requestState.thread,
    threadLoading: requestState.threadLoading,
    events: requestState.events,
    eventsLoading: requestState.eventsLoading,
    statusFilter,
    setStatusFilter,
    searchText,
    setSearchText,
    retryItems: runtimeState.retryItems,
    retryStats: runtimeState.retryStats,
    retryLoading: runtimeState.retryLoading,
    retryStatusFilter,
    setRetryStatusFilter,
    health: runtimeState.health,
    ddsStatus: runtimeState.ddsStatus,
    bootstrapToken: runtimeState.bootstrapToken,
    issuingBootstrapToken: runtimeState.issuingBootstrapToken,
    rotatingControlToken: runtimeState.rotatingControlToken,
    message,
    setMessage,
    error,
    setError,
    notConfigured,
    handoffingRequestId: requestState.handoffingRequestId,
    setSelectedRequestId: requestState.setSelectedRequestId,
    handleRetryHandoff: requestState.handleRetryHandoff,
    handleIssueBootstrapToken: runtimeState.handleIssueBootstrapToken,
    handleRotateControlToken: runtimeState.handleRotateControlToken,
  };
}
