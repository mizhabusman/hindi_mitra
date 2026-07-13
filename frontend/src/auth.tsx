import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import type { CurrentUser } from "./types";

interface AuthCtx {
  user: CurrentUser | null;
  loading: boolean;
  adminLogin: (password: string) => Promise<void>;
  employeeLogin: (userId: number, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
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

  return (
    <Ctx.Provider value={{ user, loading, adminLogin, employeeLogin, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
