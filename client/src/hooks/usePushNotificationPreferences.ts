import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

export interface PushNotificationPreferenceCategories {
  proposals: boolean;
  requests: boolean;
  comments: boolean;
  matching: boolean;
  groups: boolean;
  alerts: boolean;
  admin: boolean;
}

export interface PushNotificationPreferences {
  categories: PushNotificationPreferenceCategories;
  allowCritical: boolean;
}

const DEFAULT_PREFERENCES: PushNotificationPreferences = {
  categories: {
    proposals: true,
    requests: true,
    comments: true,
    matching: true,
    groups: true,
    alerts: true,
    admin: true,
  },
  allowCritical: true,
};

export function usePushNotificationPreferences(enabled: boolean) {
  const [preferences, setPreferences] = useState<PushNotificationPreferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled) return;

    let mounted = true;
    setLoading(true);
    setError('');
    void api.get<PushNotificationPreferences>('/push/preferences')
      .then((next) => {
        if (!mounted) return;
        setPreferences(next);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : '通知カテゴリ設定の取得に失敗しました');
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [enabled]);

  const updatePreferences = useCallback(async (patch: Partial<PushNotificationPreferences>) => {
    setSaving(true);
    setError('');
    try {
      const next = await api.put<PushNotificationPreferences>('/push/preferences', patch);
      setPreferences(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : '通知カテゴリ設定の保存に失敗しました');
    } finally {
      setSaving(false);
    }
  }, []);

  return {
    preferences,
    loading,
    saving,
    error,
    updatePreferences,
  };
}
