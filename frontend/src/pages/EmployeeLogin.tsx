import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import Brand from "../components/Brand";
import PasswordInput from "../components/PasswordInput";
import type { EmployeeOption } from "../types";

export default function EmployeeLogin() {
  const { employeeLogin } = useAuth();
  const nav = useNavigate();
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");

  // Never blank the last-known list on a transient failure — a failed/slow
  // load must NOT masquerade as "no employees yet".
  const loadEmployees = () => {
    setLoadState((s) => (s === "ready" ? s : "loading"));
    return api
      .employees()
      .then((list) => { setEmployees(list); setLoadState("ready"); })
      .catch(() => setLoadState("error"));
  };
  useEffect(() => { loadEmployees(); }, []);

  return (
    <div className="authWrap">
      <div className="loginCard">
        <Brand size="lg" />
        <div className="loginTitle">Employee Login</div>
        <div className="loginSub">Select your name and enter your password.</div>

        <LoginForm
          employees={employees}
          loadState={loadState}
          onRetry={loadEmployees}
          onLogin={employeeLogin}
          onDone={() => nav("/")}
        />

        <div className="authBack">
          <Link className="btn btn-secondary btn-sm" to="/"><ArrowLeft /> Back</Link>
        </div>
      </div>
    </div>
  );
}

function LoginForm({
  employees, loadState, onRetry, onLogin, onDone,
}: {
  employees: EmployeeOption[];
  loadState: "loading" | "ready" | "error";
  onRetry: () => void;
  onLogin: (id: number, pw: string) => Promise<void>;
  onDone: () => void;
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
          placeholder={
            loadState === "loading" ? "Loading employees…"
              : loadState === "error" ? "Couldn't load employees — tap retry"
                : employees.length ? "Search your name…"
                  : "No employees yet — ask your admin to add you"
          }
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
                <span>{e.name}</span>
                {e.employee_id && <span className="empId">{e.employee_id}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
      {loadState === "error" && (
        <div className="alert err formError">
          Couldn't load the employee list.{" "}
          <button type="button" className="linkBtn" onClick={onRetry}>Retry</button>
        </div>
      )}

      <label className="field">Password</label>
      <PasswordInput value={password} onChange={setPassword} placeholder="Enter your password" autoComplete="current-password" />
      {error && <div className="alert err formError">{error}</div>}

      <div className="loginActions">
        <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy || !selected || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </form>
  );
}
