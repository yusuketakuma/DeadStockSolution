import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
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
  testLogin: (key: 'tokyo' | 'osaka') => Promise<void>;
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
  prefecture: string;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const data = await api.get<User>('/auth/me');
      setUser(data);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
  }, [refreshUser]);

  // Auto-logout when session expires
  useEffect(() => {
    setAuthExpiredHandler(() => {
      setUser(null);
    });
    return () => setAuthExpiredHandler(() => {});
  }, []);

  const login = async (email: string, password: string): Promise<User> => {
    const data = await api.post<User>('/auth/login', { email, password });
    setUser(data);
    return data;
  };

  const testLogin = async (key: 'tokyo' | 'osaka') => {
    const data = await api.post<User>('/auth/test-login', { key });
    setUser(data);
  };

  const register = async (data: RegisterData) => {
    const result = await api.post<User>('/auth/register', data);
    setUser(result);
  };

  const logout = async () => {
    await api.post('/auth/logout');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, testLogin, register, logout, refreshUser }}>
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
