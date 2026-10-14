"use client";

/**
 * Authentication state (D16: JWT in localStorage).
 *
 * Hydration safety: the initial state is identical on the server and on the
 * first client render (`user: null`, `token: null`, `loading: true`).
 * localStorage is only read inside `useEffect`, never during render.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api } from "@/lib/api";
import type { LoginInput, SignupInput } from "@/lib/api";
import { clearToken, getToken, setToken } from "@/lib/authStorage";
import type { User } from "@/types/api";

export interface AuthContextValue {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  signup: (input: SignupInput) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function init(): Promise<void> {
      const stored = getToken();
      if (stored === null) {
        // No token: nothing to verify, so the app is ready immediately.
        if (!cancelled) {
          setLoading(false);
        }
        return;
      }

      setTokenState(stored);

      try {
        const me = await api.auth.me();
        if (!cancelled) {
          setUser(me);
        }
      } catch {
        // Expired or invalid token: drop it and stay logged out.
        if (!cancelled) {
          clearToken();
          setTokenState(null);
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void init();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<User> => {
    const input: LoginInput = { email, password };
    const result = await api.auth.login(input);
    setToken(result.token);
    setTokenState(result.token);
    setUser(result.user);
    return result.user;
  }, []);

  const signup = useCallback(async (input: SignupInput): Promise<User> => {
    const result = await api.auth.signup(input);
    setToken(result.token);
    setTokenState(result.token);
    setUser(result.user);
    return result.user;
  }, []);

  const logout = useCallback((): void => {
    clearToken();
    setTokenState(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, loading, login, signup, logout }),
    [user, token, loading, login, signup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error("useAuth must be used inside an <AuthProvider>.");
  }
  return context;
}
