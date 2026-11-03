import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { CredentialsOverviewResponse, HealthCheckResponse } from '@paysim/contracts';
import {
  apiClient,
  getHealth,
  exchangeControlSession,
  logoutControlSession,
  getCredentialsOverview,
} from '../api/index.js';

export interface AuthContextValue {
  // Native Bearer Authentication (held strictly in-memory)
  nativeToken: string | null;
  setNativeToken: (token: string | null) => void;

  // Control Session Authentication
  isControlAuthenticated: boolean;
  csrfToken: string | null;
  loginWithBootstrapToken: (token: string) => Promise<void>;
  logoutControl: () => Promise<void>;

  // Credentials Overview (metadata only, zero raw secrets)
  credentialsOverview: CredentialsOverviewResponse | null;
  refreshCredentialsOverview: () => Promise<void>;

  // Server Connectivity & Health
  serverOnline: boolean;
  serverHealth: HealthCheckResponse | null;
  checkHealth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [nativeToken, setNativeTokenState] = useState<string | null>(null);
  const [isControlAuthenticated, setIsControlAuthenticated] = useState<boolean>(false);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [credentialsOverview, setCredentialsOverview] =
    useState<CredentialsOverviewResponse | null>(null);
  const [serverOnline, setServerOnline] = useState<boolean>(false);
  const [serverHealth, setServerHealth] = useState<HealthCheckResponse | null>(null);

  const setNativeToken = useCallback((token: string | null) => {
    setNativeTokenState(token);
    apiClient.setNativeToken(token);
  }, []);

  const checkHealth = useCallback(async () => {
    try {
      const health = await getHealth();
      setServerHealth(health);
      setServerOnline(true);
    } catch {
      setServerOnline(false);
      setServerHealth(null);
    }
  }, []);

  const refreshCredentialsOverview = useCallback(async () => {
    try {
      const overview = await getCredentialsOverview();
      setCredentialsOverview(overview);
    } catch {
      // If unauthorized or error, clear overview
      setCredentialsOverview(null);
    }
  }, []);

  const loginWithBootstrapToken = useCallback(
    async (token: string) => {
      const res = await exchangeControlSession(token);
      setCsrfToken(res.csrfToken);
      setIsControlAuthenticated(true);
      await refreshCredentialsOverview();
    },
    [refreshCredentialsOverview]
  );

  const logoutControl = useCallback(async () => {
    try {
      await logoutControlSession();
    } catch {
      // ignore
    }
    setCsrfToken(null);
    setIsControlAuthenticated(false);
    setCredentialsOverview(null);
  }, []);

  // Periodic health check
  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 10000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  // Try checking existing session on mount
  useEffect(() => {
    refreshCredentialsOverview()
      .then(() => {
        setIsControlAuthenticated(true);
      })
      .catch(() => {
        setIsControlAuthenticated(false);
      });
  }, [refreshCredentialsOverview]);

  return (
    <AuthContext.Provider
      value={{
        nativeToken,
        setNativeToken,
        isControlAuthenticated,
        csrfToken,
        loginWithBootstrapToken,
        logoutControl,
        credentialsOverview,
        refreshCredentialsOverview,
        serverOnline,
        serverHealth,
        checkHealth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
