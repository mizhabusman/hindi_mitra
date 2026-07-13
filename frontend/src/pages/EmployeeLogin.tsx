import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronDown, UserPlus } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import Brand from "../components/Brand";
import PasswordInput from "../components/PasswordInput";
import type { EmployeeOption } from "../types";

export default function EmployeeLogin() {
  const { employeeLogin } = useAuth();
  const nav = useNavigate();
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [ok, setOk] = useState("");

  const loadEmployees = () => api.employees().then(setEmployees).catch(() => setEmployees([]));
  useEffect(() => { loadEmployees(); }, []);

  return (
    <div className="authWrap">
      <div className="loginCard">
        <Brand size="lg" />
        <div className="loginTitle">{mode === "login" ? "Employee Login" : "Register Employee"}</div>
        <div className="loginSub">
          {mode === "login" ? "Select your name and enter your password." : "Create a new employee account."}
        </div>
        {ok && <div className="alert ok formError">{ok}</div>}

        {mode === "login" ? (
          <LoginForm
            employees={employees}
            onLogin={employeeLogin}
            onDone={() => nav("/")}
            goRegister={() => { setOk(""); setMode("register"); }}
          />
        ) : (
          <RegisterForm
            onRegistered={async (name) => {
              await loadEmployees();
              setOk(`Employee "${name}" registered successfully.`);
              setMode("login");
            }}
            onCancel={() => setMode("login")}
          />
        )}

        <div className="authBack">
          <Link className="btn btn-secondary btn-sm" to="/"><ArrowLeft /> Back</Link>
        </div>
      </div>
    </div>
  );
}

function LoginForm({
  employees, onLogin, onDone, goRegister,
}: {
  employees: EmployeeOption[];
  onLogin: (id: number, pw: string) => Promise<void>;
  onDone: () => void;
  goRegister: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<EmployeeOption | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? employees.filter((e) => e.name.toLowerCase().includes(q)) : employees).slice(0, 50);
  }, [employees, query]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Keep the highlighted option valid and scrolled into view.
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pick = (emp: EmployeeOption) => { setSelected(emp); setQuery(emp.name); setOpen(false); };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      if (open && filtered[active]) { e.preventDefault(); pick(filtered[active]); }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected) { setError("Please select your name from the list."); return; }
    setError("");
    setBusy(true);
    try {
      await onLogin(selected.id, password);
      onDone();
    } catch {
      setError("Incorrect password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <label className="field">Employee</label>
      <div className="combo" ref={boxRef}>
        <input
          value={query}
          placeholder={employees.length ? "Search your name…" : "No employees yet — register below"}
          onChange={(e) => { setQuery(e.target.value); setSelected(null); setOpen(true); }}
          onFocus={() => { setOpen(true); setActive(0); }}
          onKeyDown={onKey}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          autoComplete="off"
          style={{ paddingRight: 36 }}
        />
        <ChevronDown size={17} style={{ position: "absolute", right: 12, top: 12, color: "var(--muted)", pointerEvents: "none" }} />
        {open && filtered.length > 0 && (
          <div className="comboList" ref={listRef} role="listbox">
            {filtered.map((e, i) => (
              <div
                key={e.id}
                className="comboItem"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={() => pick(e)}
              >
                {e.name}
              </div>
            ))}
          </div>
        )}
      </div>

      <label className="field">Password</label>
      <PasswordInput value={password} onChange={setPassword} placeholder="Enter your password" autoComplete="current-password" />
      {error && <div className="alert err formError">{error}</div>}

      <div className="loginActions">
        <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy || !selected || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <button type="button" className="btn btn-secondary btn-block" onClick={goRegister}>
          <UserPlus /> Register new employee
        </button>
      </div>
    </form>
  );
}

function RegisterForm({
  onRegistered, onCancel,
}: {
  onRegistered: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api.registerEmployee(name.trim(), password);
      await onRegistered(name.trim());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <label className="field">Employee Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoFocus />
      <label className="field">Password</label>
      <PasswordInput value={password} onChange={setPassword} placeholder="At least 6 characters" autoComplete="new-password" />
      {error && <div className="alert err formError">{error}</div>}

      <div className="loginActions">
        <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy || !name.trim() || password.length < 6}>
          {busy ? "Registering…" : "Register"}
        </button>
        <button type="button" className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
