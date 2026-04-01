import { useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { AdminPharmacyData } from './useAdminPharmacyEdit.types';

export interface UseAdminPharmacyDataReturn {
  pharmacyId: number;
  hasValidId: boolean;
  pharmacy: AdminPharmacyData | null;
  setPharmacy: React.Dispatch<React.SetStateAction<AdminPharmacyData | null>>;
  pharmacyLoaded: boolean;
  setPharmacyLoaded: React.Dispatch<React.SetStateAction<boolean>>;
  error: string;
  setError: (value: string) => void;
  message: string;
  setMessage: (value: string) => void;
  activeUpdating: boolean;
  verifyLoading: boolean;
  navigate: ReturnType<typeof useNavigate>;
  loadPharmacy: (signal?: AbortSignal) => Promise<void>;
  handleToggleActive: () => Promise<void>;
  handleVerify: (approved: boolean, reason?: string) => Promise<void>;
}

/**
 * 薬局データの取得・更新状態・アクティブ切替・審査処理を管理するフック
 */
export function useAdminPharmacyData(): UseAdminPharmacyDataReturn {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const pharmacyId = Number(id);
  const hasValidId = Number.isInteger(pharmacyId) && pharmacyId > 0;

  const [pharmacy, setPharmacy] = useState<AdminPharmacyData | null>(null);
  const [pharmacyLoaded, setPharmacyLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [activeUpdating, setActiveUpdating] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);

  // --- データ取得 ---
  const loadPharmacy = useCallback(async (signal?: AbortSignal) => {
    if (!hasValidId) return;
    try {
      const data = await api.get<AdminPharmacyData>(`/admin/pharmacies/${pharmacyId}`, { signal });
      if (signal?.aborted) return;
      setPharmacy(data);
    } catch (err) {
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : '薬局情報の取得に失敗しました');
    } finally {
      if (!signal?.aborted) {
        setPharmacyLoaded(true);
      }
    }
  }, [hasValidId, pharmacyId]);

  // --- アクティブ切替 ---
  const handleToggleActive = async () => {
    if (!hasValidId || !pharmacy) return;
    setError('');
    setMessage('');
    setActiveUpdating(true);
    try {
      const result = await api.put<{ message: string }>(`/admin/pharmacies/${pharmacyId}/toggle-active`);
      setMessage(result.message);
      setPharmacy((prev) => (prev ? { ...prev, isActive: !prev.isActive } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : '状態変更に失敗しました');
    } finally {
      setActiveUpdating(false);
    }
  };

  // --- 審査処理 ---
  const handleVerify = async (approved: boolean, reason?: string) => {
    setVerifyLoading(true);
    try {
      await api.post(`/admin/pharmacies/${pharmacyId}/verify`, {
        approved,
        reason: reason || undefined,
      });
      const updated = await api.get<AdminPharmacyData>(`/admin/pharmacies/${pharmacyId}`);
      setPharmacy(updated);
      setMessage(approved ? '薬局を承認しました' : '薬局を却下しました');
    } catch (err) {
      alert(err instanceof Error ? err.message : '審査処理に失敗しました');
    } finally {
      setVerifyLoading(false);
    }
  };

  return {
    pharmacyId,
    hasValidId,
    pharmacy,
    setPharmacy,
    pharmacyLoaded,
    setPharmacyLoaded,
    error,
    setError,
    message,
    setMessage,
    activeUpdating,
    verifyLoading,
    navigate,
    loadPharmacy,
    handleToggleActive,
    handleVerify,
  };
}
