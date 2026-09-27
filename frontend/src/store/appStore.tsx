import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { UNAUTHORIZED_EVENT, clearToken, getToken, setToken } from "../lib/api";
import { fetchMe, type AuthUser, type UserRole } from "../services/authService";

export type { UserRole };
export type ConnectivityState = "ONLINE" | "OFFLINE" | "SYNCING";
export type ThemeMode = "dark" | "light";

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  language: string;
  avatar: string;
}

interface AppState {
  language: string;
  theme: ThemeMode;
  connectivity: ConnectivityState;
  demoMode: boolean;
  emergencyMode: boolean;
  offlineQueue: number;
  notifications: number;
  isAuthenticated: boolean;
  user: UserProfile | null;
}

interface AppContextValue extends AppState {
  setLanguage: (language: string) => void;
  setTheme: (theme: ThemeMode) => void;
  setConnectivity: (state: ConnectivityState) => void;
  toggleConnectivity: () => void;
  toggleDemoMode: () => void;
  toggleEmergencyMode: () => void;
  incrementNotifications: () => void;
  clearNotifications: () => void;
  queueOfflineReport: () => void;
  syncOfflineReports: () => void;
  /** Stores the token from a successful login/verify/reset and marks us signed in. */
  signIn: (token: string, user: AuthUser) => void;
  logout: () => void;
}

const STORAGE_KEY = "ner-logix-app-state";

const defaultState: AppState = {
  language: "English",
  theme: "dark",
  connectivity: "ONLINE",
  demoMode: true,
  emergencyMode: false,
  offlineQueue: 0,
  notifications: 4,
  isAuthenticated: false,
  user: null,
};

const AppContext = createContext<AppContextValue | undefined>(undefined);

function toProfile(user: AuthUser, language: string): UserProfile {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    language,
    avatar:
      user.name
        .split(" ")
        .filter(Boolean)
        .map((part) => part[0])
        .slice(0, 2)
        .join("")
        .toUpperCase() || "?",
  };
}

function readInitialState(): AppState {
  if (typeof window === "undefined") {
    return defaultState;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const saved: AppState = raw
      ? { ...defaultState, ...JSON.parse(raw) }
      : defaultState;

    // The token, not the persisted flag, decides whether we are signed in.
    // The earlier demo login saved `isAuthenticated: true` with no token, and
    // that stale session made every page render while every API call returned
    // 401. Without a token there is nothing to be signed in *with*.
    if (!getToken() || !saved.user) {
      return { ...saved, isAuthenticated: false, user: null };
    }

    return { ...saved, isAuthenticated: true };
  } catch {
    return defaultState;
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(readInitialState);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
  }, [state.theme]);

  // The backend rejected our token (expired or account changed): back to login.
  useEffect(() => {
    const handleUnauthorized = () =>
      setState((prev) => ({ ...prev, isAuthenticated: false, user: null }));

    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  }, []);

  // On load, refresh the profile from the server. This picks up a role change
  // (say, a promotion) and confirms the stored token still works. A 401 is
  // handled centrally by apiFetch; a network failure is ignored so being
  // offline does not sign anyone out.
  useEffect(() => {
    if (!getToken()) return;

    fetchMe()
      .then((me) =>
        setState((prev) => ({ ...prev, user: toProfile(me, prev.language) })),
      )
      .catch(() => {});
  }, []);

  const contextValue = useMemo<AppContextValue>(() => ({
    ...state,
    setLanguage: (language) => setState((prev) => ({ ...prev, language })),
    setTheme: (theme) => setState((prev) => ({ ...prev, theme })),
    setConnectivity: (connectivity) => setState((prev) => ({ ...prev, connectivity })),
    toggleConnectivity: () =>
      setState((prev) => {
        const next = prev.connectivity === "ONLINE" ? "OFFLINE" : "ONLINE";
        return { ...prev, connectivity: next };
      }),
    toggleDemoMode: () => setState((prev) => ({ ...prev, demoMode: !prev.demoMode })),
    toggleEmergencyMode: () =>
      setState((prev) => ({ ...prev, emergencyMode: !prev.emergencyMode })),
    incrementNotifications: () =>
      setState((prev) => ({ ...prev, notifications: prev.notifications + 1 })),
    clearNotifications: () => setState((prev) => ({ ...prev, notifications: 0 })),
    queueOfflineReport: () =>
      setState((prev) => ({ ...prev, offlineQueue: prev.offlineQueue + 1 })),
    syncOfflineReports: () => setState((prev) => ({ ...prev, offlineQueue: 0 })),
    signIn: (token, user) => {
      setToken(token);
      setState((prev) => ({
        ...prev,
        isAuthenticated: true,
        user: toProfile(user, prev.language),
      }));
    },
    logout: () => {
      clearToken();
      setState((prev) => ({ ...prev, isAuthenticated: false, user: null }));
    },
  }), [state]);

  return <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>;
}

export function useAppStore() {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error("useAppStore must be used within AppProvider");
  }

  return context;
}
