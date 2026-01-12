import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '../types';
import { api } from '../services/api';
import { subscribeRealtime, stopRealtime } from '../services/realtime';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (mobile: string, pass: string) => Promise<User>;
  loginAdmin: (username: string, pass: string) => Promise<User>;
  register: (name: string, mobile: string, pass: string, mediatorCode: string) => Promise<void>;
  registerOps: (
    name: string,
    mobile: string,
    pass: string,
    role: 'agency' | 'mediator',
    code: string
  ) => Promise<{ pendingApproval?: boolean; message?: string } | void>;
  registerBrand: (name: string, mobile: string, pass: string, brandCode: string) => Promise<void>;
  updateUser: (updates: Partial<User>) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Realtime: keep the local user snapshot in sync (approval status, wallet balances, etc.)
  useEffect(() => {
    if (!user?.id) return;
    let timer: any = null;
    let inFlight = false;

    const scheduleRefresh = () => {
      if (timer) return;
      timer = setTimeout(async () => {
        timer = null;
        if (inFlight) return;
        inFlight = true;
        try {
          const me = await api.auth.me();
          setUser(me);
          localStorage.setItem('mobo_session', JSON.stringify(me));
        } catch {
          // If token became invalid, restoreSession() will handle on next load.
        } finally {
          inFlight = false;
        }
      }, 600);
    };

    const unsub = subscribeRealtime((msg) => {
      if (msg.type === 'users.changed') {
        const changedId = msg.payload?.userId;
        if (!changedId || String(changedId) === String(user.id)) scheduleRefresh();
      }
      if (msg.type === 'wallets.changed') scheduleRefresh();
    });

    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [user?.id]);

  useEffect(() => {
    const restoreSession = async () => {
      try {
        const storedUser = localStorage.getItem('mobo_session');
        if (!storedUser) return;

        // If we have a stored user but no access token, treat it as logged-out.
        const rawTokens = localStorage.getItem('mobo_tokens_v1');
        if (!rawTokens) {
          localStorage.removeItem('mobo_session');
          return;
        }

        // Validate token and refresh user from backend.
        const me = await api.auth.me();
        setUser(me);
        localStorage.setItem('mobo_session', JSON.stringify(me));
      } catch {
        // Any failure => clear local auth state and show splash.
        localStorage.removeItem('mobo_session');
        localStorage.removeItem('mobo_tokens_v1');
        setUser(null);
      }
    };

    restoreSession().finally(() => setIsLoading(false));
  }, []);

  const login = async (mobile: string, pass: string) => {
    const loggedInUser = (await api.auth.login(mobile, pass)) as User;
    setUser(loggedInUser);
    localStorage.setItem('mobo_session', JSON.stringify(loggedInUser));
    return loggedInUser;
  };

  const loginAdmin = async (username: string, pass: string) => {
    const loggedInUser = (await api.auth.loginAdmin(username, pass)) as User;
    setUser(loggedInUser);
    localStorage.setItem('mobo_session', JSON.stringify(loggedInUser));
    return loggedInUser;
  };

  const register = async (name: string, mobile: string, pass: string, mediatorCode: string) => {
    const newUser = await api.auth.register(name, mobile, pass, mediatorCode);
    setUser(newUser);
    localStorage.setItem('mobo_session', JSON.stringify(newUser));
  };

  const registerOps = async (
    name: string,
    mobile: string,
    pass: string,
    role: 'agency' | 'mediator',
    code: string
  ) => {
    const result = await api.auth.registerOps(name, mobile, pass, role, code);

    // Pending approval means: create request, but don't authenticate the mediator yet.
    if (result && typeof result === 'object' && (result as any).pendingApproval) {
      return { pendingApproval: true, message: (result as any).message };
    }

    const newUser = result as User;
    setUser(newUser);
    localStorage.setItem('mobo_session', JSON.stringify(newUser));
  };

  const registerBrand = async (name: string, mobile: string, pass: string, brandCode: string) => {
    const newUser = await api.auth.registerBrand(name, mobile, pass, brandCode);
    setUser(newUser);
    localStorage.setItem('mobo_session', JSON.stringify(newUser));
  };

  const updateUser = async (updates: Partial<User>) => {
    if (!user) return;
    try {
      const updatedUser = await api.auth.updateProfile(user.id, updates);
      setUser(updatedUser);
      localStorage.setItem('mobo_session', JSON.stringify(updatedUser));
    } catch (e) {
      throw e;
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('mobo_session');
    localStorage.removeItem('mobo_tokens_v1');
    stopRealtime();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        login,
        loginAdmin,
        register,
        registerOps,
        registerBrand,
        updateUser,
        logout,
        isLoading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
