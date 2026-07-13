import { Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "./auth";
import Landing from "./pages/Landing";
import AdminLogin from "./pages/AdminLogin";
import EmployeeLogin from "./pages/EmployeeLogin";
import Practice from "./pages/Practice";
import Admin from "./pages/Admin";
import EmployeeDetail from "./pages/EmployeeDetail";

function Protected({ children, adminOnly }: { children: ReactNode; adminOnly?: boolean }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center"><span className="spinner" /></div>;
  if (!user) return <Navigate to="/" replace />;
  if (adminOnly && user.role !== "admin") return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="center"><span className="spinner" /></div>;

  return (
    <Routes>
      <Route
        path="/"
        element={!user ? <Landing /> : user.role === "admin" ? <Navigate to="/admin" replace /> : <Practice />}
      />
      <Route path="/login/admin" element={user ? <Navigate to="/" replace /> : <AdminLogin />} />
      <Route path="/login/employee" element={user ? <Navigate to="/" replace /> : <EmployeeLogin />} />
      <Route
        path="/practice"
        element={
          <Protected>
            <Practice />
          </Protected>
        }
      />
      <Route
        path="/admin"
        element={
          <Protected adminOnly>
            <Admin />
          </Protected>
        }
      />
      <Route
        path="/admin/employees/:id"
        element={
          <Protected adminOnly>
            <EmployeeDetail />
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
