import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "../auth";
import Brand from "../components/Brand";
import PasswordInput from "../components/PasswordInput";

export default function AdminLogin() {
  const { adminLogin } = useAuth();
  const nav = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await adminLogin(password);
      nav("/admin");
    } catch {
      setError("Incorrect admin password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="authWrap">
      <form className="loginCard" onSubmit={submit}>
        <Brand size="lg" />
        <div className="loginTitle">Admin Login</div>
        <div className="loginSub">Enter the admin password to continue.</div>
        {error && <div className="alert err formError">{error}</div>}
        <label className="field">Password</label>
        <PasswordInput
          value={password}
          onChange={setPassword}
          placeholder="Enter Admin Password"
          autoFocus
          autoComplete="current-password"
        />
        <div className="loginActions">
          <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>
        <div className="authBack">
          <Link className="btn btn-secondary btn-sm" to="/"><ArrowLeft /> Back</Link>
        </div>
      </form>
    </div>
  );
}
