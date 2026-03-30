import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';
import { loginAdmin } from '../api/auth';

const STORAGE_KEY = 'theater.mobile.adminToken';

type AuthContextValue = {
  token: string | null;
  isLoading: boolean;
  login: (params: { username: string; password: string; otpCode?: string }) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadStoredToken = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) setToken(stored);
      } finally {
        setIsLoading(false);
      }
    };

    loadStoredToken().catch(() => {
      setIsLoading(false);
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      isLoading,
      login: async ({ username, password, otpCode }) => {
        const result = await loginAdmin({ username, password, otpCode: otpCode?.trim() || undefined });
        setToken(result.token);
        await AsyncStorage.setItem(STORAGE_KEY, result.token);
      },
      logout: async () => {
        setToken(null);
        await AsyncStorage.removeItem(STORAGE_KEY);
      }
    }),
    [isLoading, token]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
}
