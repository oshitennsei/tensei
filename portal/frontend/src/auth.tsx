import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { ReactNode } from "react";
import { api, type AuthorData } from "./api";

const SESSION_KEY = "tensei_session";

interface AuthCtx {
  token: string | null;
  author: AuthorData | null;
  loading: boolean;
  login: (token: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(SESSION_KEY));
  const [author, setAuthor] = useState<AuthorData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMe = useCallback(async (t: string) => {
    try {
      const data = await api.me(t);
      setAuthor(data);
    } catch {
      localStorage.removeItem(SESSION_KEY);
      setToken(null);
      setAuthor(null);
    }
  }, []);

  useEffect(() => {
    if (token) {
      fetchMe(token).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [token, fetchMe]);

  const login = async (t: string) => {
    localStorage.setItem(SESSION_KEY, t);
    setToken(t);
    await fetchMe(t);
  };

  const logout = () => {
    localStorage.removeItem(SESSION_KEY);
    setToken(null);
    setAuthor(null);
  };

  const refresh = async () => {
    if (token) await fetchMe(token);
  };

  return (
    <AuthContext.Provider value={{ token, author, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
