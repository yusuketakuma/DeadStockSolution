import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { api, ApiError } from '../api/client';
import { setAuthExpiredHandler } from '../api/client';

interface User {
  id: number;
  email: string;
  name: string;
  prefecture: string;
  isAdmin: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

interface RegisterData {
  email: string;
  password: string;
  name: string;
  postalCode: string;
  address: string;
  phone: string;
  fax: string;
  licenseNumber: string;
  permitLicenseNumber: string;
  permitPharmacyName: string;
  permitAddress: string;
  prefecture: string;
}

const AuthContext = createContext<AuthContextType | null>(null);

interface AuthProviderProps {
  children: React.ReactNode;
  initialUser?: User | null;
  initialLoading?: boolean;
  disableInitialRefresh?: boolean;
}

export function AuthProvider({
  children,
  initialUser = null,
  initialLoading = true,
  disableInitialRefresh = false,
}: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(initialUser);
  const [loading, setLoading] = useState(initialLoading);
  const skipNextRefreshRef = React.useRef(false);

  const refreshUser = useCallback(async () => {
    if (skipNextRefreshRef.current) {
      skipNextRefreshRef.current = false;
      return;
    }
    try {
      const data = await api.get<User>('/auth/me');
      setUser(data);
    } catch (err) {
      // 401 (認証切れ) の場合のみユーザー状態をクリア
      // 5xx/ネットワークエラー時はセッション維持（一時的障害の可能性）
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
      }
    }
  }, []);

  useEffect(() => {
    if (disableInitialRefresh) {
      setLoading(false);
      return;
    }
    void refreshUser().finally(() => setLoading(false));
  }, [disableInitialRefresh, refreshUser]);

  // Auto-logout when session expires
  useEffect(() => {
    setAuthExpiredHandler(() => {
      setUser(null);
    });
    return () => setAuthExpiredHandler(() => {});
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<User> => {
    const data = await api.post<User>('/auth/login', { email, password });
    skipNextRefreshRef.current = true;
    setUser(data);
    return data;
  }, []);

  const register = useCallback(async (data: RegisterData) => {
    await api.post('/auth/register', data);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch (err) {
      console.warn('Logout request failed, clearing local auth state only');
    } finally {
      setUser(null);
      try {
        localStorage.removeItem('dss.currentPath');
        localStorage.removeItem('dss.previousPath');
        localStorage.removeItem('installPromptSnoozed');
        const keysToRemove = Object.keys(localStorage).filter(
          (key) => key.startsWith('draft:') || key.startsWith('dss.onboarding.'),
        );
        keysToRemove.forEach((key) => localStorage.removeItem(key));
      } catch {
        // localStorage may be unavailable in private browsing
      }
    }
  }, []);

  const value = useMemo(() => ({
    user, loading, login, register, logout, refreshUser
  }), [user, loading, login, register, logout, refreshUser]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
