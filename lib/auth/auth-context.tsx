'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type UserRole = 'admin' | 'generator' | 'viewer';

export interface User {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  displayName: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<boolean>;
  hasRole: (role: UserRole | UserRole[]) => boolean;
  canGenerate: boolean;
  canAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const API_BASE = '/api';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Check for existing session on mount
  useEffect(() => {
    const initAuth = async () => {
      const tokens = getStoredTokens();
      if (tokens?.accessToken) {
        try {
          // Verify token and get user info
          const response = await fetch(`${API_BASE}/auth`, {
            headers: {
              'Authorization': `Bearer ${tokens.accessToken}`,
            },
          });

          if (response.ok) {
            const data = await response.json();
            if (data.success) {
              setUser(data.user);
            }
          } else if (response.status === 401) {
            // Try to refresh token
            const refreshed = await refreshTokenInternal();
            if (!refreshed) {
              clearStoredTokens();
            }
          }
        } catch (error) {
          console.error('Auth initialization error:', error);
        }
      }
      setIsLoading(false);
    };

    initAuth();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const response = await fetch(`${API_BASE}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', username, password }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Login failed');
    }

    storeTokens(data.tokens);
    setUser(data.user);
  }, []);

  const register = useCallback(async (
    username: string,
    email: string,
    password: string,
    displayName?: string
  ) => {
    const response = await fetch(`${API_BASE}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'register',
        username,
        email,
        password,
        displayName,
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Registration failed');
    }

    storeTokens(data.tokens);
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    const tokens = getStoredTokens();
    if (tokens?.refreshToken) {
      try {
        await fetch(`${API_BASE}/auth`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'logout', refreshToken: tokens.refreshToken }),
        });
      } catch {
        // Ignore errors during logout
      }
    }

    clearStoredTokens();
    setUser(null);
  }, []);

  const refreshToken = useCallback(async (): Promise<boolean> => {
    return refreshTokenInternal();
  }, []);

  const hasRole = useCallback((role: UserRole | UserRole[]): boolean => {
    if (!user) return false;
    const roles = Array.isArray(role) ? role : [role];
    return roles.includes(user.role);
  }, [user]);

  const canGenerate = user?.role === 'admin' || user?.role === 'generator';
  const canAdmin = user?.role === 'admin';

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    register,
    logout,
    refreshToken,
    hasRole,
    canGenerate,
    canAdmin,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Token storage helpers
const TOKEN_KEY = 'openmaic_tokens';

function getStoredTokens(): AuthTokens | null {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem(TOKEN_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

function storeTokens(tokens: AuthTokens): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));

  // Also set cookie for middleware
  document.cookie = `accessToken=${tokens.accessToken};path=/;max-age=${tokens.expiresIn}`;
  document.cookie = `refreshToken=${tokens.refreshToken};path=/;max-age=${7 * 24 * 60 * 60}`;
}

function clearStoredTokens(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);

  // Clear cookies
  document.cookie = 'accessToken=;path=/;max-age=0';
  document.cookie = 'refreshToken=;path=/;max-age=0';
}

async function refreshTokenInternal(): Promise<boolean> {
  const tokens = getStoredTokens();
  if (!tokens?.refreshToken) return false;

  try {
    const response = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'refresh', refreshToken: tokens.refreshToken }),
    });

    const data = await response.json();

    if (response.ok && data.success) {
      storeTokens(data.tokens);
      return true;
    }
  } catch (error) {
    console.error('Token refresh error:', error);
  }

  return false;
}

// API client with auth header
export async function fetchWithAuth(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const tokens = getStoredTokens();

  const headers = new Headers(options.headers);
  if (tokens?.accessToken) {
    headers.set('Authorization', `Bearer ${tokens.accessToken}`);
  }

  let response = await fetch(url, { ...options, headers });

  // If token expired, try to refresh
  if (response.status === 401) {
    const refreshed = await refreshTokenInternal();
    if (refreshed) {
      const newTokens = getStoredTokens();
      headers.set('Authorization', `Bearer ${newTokens!.accessToken}`);
      response = await fetch(url, { ...options, headers });
    }
  }

  return response;
}
