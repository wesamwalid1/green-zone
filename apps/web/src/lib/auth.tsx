import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from './api';

type User = {
  id: string;
  username: string;
  fullName: string;
  jobTitle?: string | null;
  role: string;
  /** فارغ = كل المخازن (مدير أو من غير ربط). غير فارغ = مخازن المستخدم فقط. */
  warehouseIds?: string[];
  access?: Record<string, { view: boolean; actions: string[]; fields: string[] }>;
};

type AuthCtx = {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('m5azen_token');
    if (!token) {
      setLoading(false);
      return;
    }
    api<User>('/auth/me')
      .then(setUser)
      .catch(() => localStorage.removeItem('m5azen_token'))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api<{ accessToken: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    localStorage.setItem('m5azen_token', res.accessToken);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('m5azen_token');
    setUser(null);
  }, []);

  // نبضة حضور للسيرفر طول ما الجلسة مفتوحة (أونلاين = متصل بالـ API)
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const beat = () => {
      if (cancelled || document.visibilityState === 'hidden') return;
      api('/auth/heartbeat', { method: 'POST', body: '{}' }).catch(() => undefined);
    };
    beat();
    const timer = window.setInterval(beat, 45_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') beat();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user]);

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth outside provider');
  return ctx;
}

export function useAccess() {
  const { user } = useAuth();
  return {
    can(page: string, action = 'view') {
      const grant = user?.access?.[page];
      if (!user?.access) return true;
      if (!grant?.view) return false;
      return action === 'view' || grant.actions.includes(action);
    },
    see(page: string, field: string) {
      if (!user?.access) return true;
      return !!user.access[page]?.fields.includes(field);
    },
  };
}
