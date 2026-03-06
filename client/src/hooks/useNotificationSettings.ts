import { useState, useCallback, useMemo, type ChangeEvent } from 'react';
import { api, isConflictError } from '../api/client';
import type { AccountData } from '../components/account/types';

interface UseNotificationSettingsOptions {
  account: AccountData | null;
  setAccount: React.Dispatch<React.SetStateAction<AccountData | null>>;
  applyLatestAccountData: (latestData: AccountData) => void;
  setError: (error: string) => void;
  setAccountConflict: (value: boolean) => void;
}

export interface UseNotificationSettingsReturn {
  notifySaving: boolean;
  matchingAutoNotify: boolean;
  handleNotifyToggle: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
}

export function useNotificationSettings({
  account,
  setAccount,
  applyLatestAccountData,
  setError,
  setAccountConflict,
}: UseNotificationSettingsOptions): UseNotificationSettingsReturn {
  const [notifySaving, setNotifySaving] = useState(false);

  const matchingAutoNotify = useMemo(
    () => account?.matchingAutoNotifyEnabled ?? true,
    [account?.matchingAutoNotifyEnabled],
  );

  const handleNotifyToggle = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const enabled = e.target.checked;
    const previousValue = account?.matchingAutoNotifyEnabled ?? true;
    const currentVersion = account?.version;
    // 楽観的にUIを更新
    setAccount((prev) => prev ? { ...prev, matchingAutoNotifyEnabled: enabled } : prev);
    setNotifySaving(true);
    setError('');
    try {
      const result = await api.put<{ message: string; version: number }>('/account', {
        matchingAutoNotifyEnabled: enabled,
        version: currentVersion,
      });
      setAccount((prev) => prev ? { ...prev, matchingAutoNotifyEnabled: enabled, version: result.version } : prev);
    } catch (err) {
      if (isConflictError(err)) {
        setAccountConflict(true);
        const latestData = err.data.latestData as AccountData | undefined;
        if (latestData) {
          applyLatestAccountData(latestData);
        } else {
          // ロールバック
          setAccount((prev) => prev ? { ...prev, matchingAutoNotifyEnabled: previousValue } : prev);
        }
        setError('他のデバイスまたはタブで更新されています。最新データを読み込みました。通知設定を確認して再度保存してください。');
      } else {
        // ロールバック
        setAccount((prev) => prev ? { ...prev, matchingAutoNotifyEnabled: previousValue } : prev);
        setError(err instanceof Error ? err.message : '通知設定の保存に失敗しました');
      }
    } finally {
      setNotifySaving(false);
    }
  }, [account, applyLatestAccountData, setAccount, setAccountConflict, setError]);

  return {
    notifySaving,
    matchingAutoNotify,
    handleNotifyToggle,
  };
}
