import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "./api";
import type { CurrentUser } from "./types";

interface AuthCtx {
  user: CurrentUser | null;
  loading: boolean;
  adminLogin: (password: string) => Promise<void>;
  employeeLogin: (userId: number, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

// Set once per page load when the app is opened with "?fresh" (the run.bat
// launcher does this so a demo always starts at the login screen). Kept at
// module scope so React StrictMode's dev double-mount can't resurrect the
// session with a second /me call while the fresh logout is still in flight.
let freshStart = false;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Resolve the current user on load. A 401 means genuinely not logged in.
  // Any other failure (network blip, 5xx, timeout — e.g. during a backend
  // restart) is transient: retry a few times rather than dumping a validly
  // logged-in user onto the login screen.
  useEffect(() => {
    let cancelled = false;

    // Fresh-start launch (run.bat opens "…/?fresh"): always begin at the login
    // screen. Clear any existing session, strip the marker from the URL so a
    // refresh doesn't re-trigger, and show the landing page — never auto-resume
    // into the dashboard. Any other way of opening the app is unaffected.
    if (freshStart || new URLSearchParams(window.location.search).has("fresh")) {
      freshStart = true;
      if (window.location.search) {
        window.history.replaceState({}, "", window.location.pathname);
      }
      void api.logout().catch(() => {});  // clear the server session in the background
      setUser(null);
      setLoading(false);
      return () => { cancelled = true; };
    }

    // Enough attempts (~18s of backoff) to ride out a backend restart/deploy
    // without dropping a logged-in user to the login screen. The app shows the
    // loading spinner throughout, not a misleading "please log in".
    const MAX_ATTEMPTS = 8;
    const check = async (attempt = 0) => {
      try {
        const u = await api.me();
        if (!cancelled) { setUser(u); setLoading(false); }
      } catch (e) {
        if (cancelled) return;
        const status = e instanceof ApiError ? e.status : 0;
        if (status === 401) {
          // Genuinely not authenticated — go to login immediately.
          setUser(null);
          setLoading(false);
        } else if (attempt < MAX_ATTEMPTS) {
          // Transient (network / 5xx / timeout): keep the spinner and retry.
          setTimeout(() => check(attempt + 1), Math.min(1000 * (attempt + 1), 2500));
        } else {
          // Server still unreachable after ~18s — fall back to login. The
          // session cookie is preserved, so a later reload restores the session.
          setUser(null);
          setLoading(false);
        }
      }
    };
    check();
    return () => { cancelled = true; };
  }, []);

  const adminLogin = async (password: string) => {
    setUser(await api.adminLogin(password));
  };
  const employeeLogin = async (userId: number, password: string) => {
    setUser(await api.employeeLogin(userId, password));
  };
  const logout = async () => {
    await api.logout();
    setUser(null);
  };
  const refresh = async () => {
    try { setUser(await api.me()); } catch { /* keep current */ }
  };

  return (
    <Ctx.Provider value={{ user, loading, adminLogin, employeeLogin, logout, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
