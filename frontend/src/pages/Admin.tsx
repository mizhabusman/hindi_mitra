import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardCheck, Clock, KeyRound, MessagesSquare, Mic, Trash2, UserPlus, Users, Wallet, X } from "lucide-react";
import { api } from "../api";
import Brand from "../components/Brand";
import ProfileMenu from "../components/ProfileMenu";
import UserBadge from "../components/UserBadge";
import GradeScale from "../components/GradeScale";
import PasswordInput from "../components/PasswordInput";
import type { Overview, UserMetrics } from "../types";
import { fmtDate, fmtTime } from "../format";

export default function Admin() {
  const nav = useNavigate();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<UserMetrics[] | null>(null);
  const [msg, setMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [resetUser, setResetUser] = useState<UserMetrics | null>(null);
  const [delTarget, setDelTarget] = useState<UserMetrics | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const load = async () => {
    const [ov, us] = await Promise.all([api.overview(), api.adminUsers()]);
    setOverview(ov);
    setUsers(us);
  };
  useEffect(() => { load(); }, []);

  const confirmDelete = async () => {
    if (!delTarget) return;
    try {
      await api.deleteUser(delTarget.id);
      setDelTarget(null);
      load();
    } catch (err) {
      setMsg((err as Error).message);
      setDelTarget(null);
    }
  };
  const toggleActive = async (u: UserMetrics) => {
    await api.updateUser(u.id, { is_active: !u.is_active });
    load();
  };

  const employees = (users ?? []).filter((u) => u.role !== "admin");
  const admins = (users ?? []).filter((u) => u.role === "admin");

  return (
    <div className="app">
      <header className="topbar">
        <Brand size="md" sub="Employees dashboard" />
        <div className="topActions">
          <button className="btn btn-primary btn-sm" onClick={() => nav("/practice")}><Mic /> Speaking Tool</button>
          <ProfileMenu />
        </div>
      </header>

      <div className="page">
        {msg && <div className="banner">{msg}</div>}
        {okMsg && <div className="alert ok" style={{ marginBottom: 16 }}>{okMsg}</div>}

        {/* PRIMARY: employees + assessments */}
        <div className="panel">
          <div className="panelHead employeesHead">
            <div className="employeesHeadMain">
              <h2>Employees</h2>
              <button className="btn btn-primary btn-sm" onClick={() => { setOkMsg(""); setMsg(""); setAddOpen(true); }}>
                <UserPlus /> Add employee
              </button>
            </div>
            <span className="muted">{employees.length} total · click a row to open their dashboard</span>
          </div>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th><th>Conversations</th><th>Assessments</th><th>Avg score</th>
                  <th>Level</th><th>Practice</th><th>Last active</th><th></th>
                </tr>
              </thead>
              <tbody>
                {users === null && (
                  <tr><td colSpan={8}><div className="loadingRow"><span className="spinner" /> Loading employees…</div></td></tr>
                )}
                {users !== null && employees.length === 0 && (
                  <tr><td colSpan={8} className="emptyCell">
                    No employees yet. Use <b>Add employee</b> to create one.
                  </td></tr>
                )}
                {employees.map((u) => (
                  <tr key={u.id} className="clickRow" style={{ opacity: u.is_active ? 1 : 0.5 }}
                      onClick={() => nav(`/admin/employees/${u.id}`)}>
                    <td>
                      <span className="nameCell">
                        <UserBadge name={u.display_name || u.username} strong />
                        {u.employee_id && <span className="empId">{u.employee_id}</span>}
                      </span>
                    </td>
                    <td>{u.conversations}</td>
                    <td>{u.assessments}</td>
                    <td>{u.avg_score ?? "—"}</td>
                    <td>{u.latest_level ? <span className="cefr">{u.latest_level}</span> : "—"}</td>
                    <td>{fmtTime(u.practice_seconds)}</td>
                    <td>{fmtDate(u.latest_activity)}</td>
                    <td className="actions" onClick={(e) => e.stopPropagation()}>
                      <button className="iconBtn" title="Reset password" aria-label={`Reset ${u.display_name || u.username}'s password`}
                        onClick={() => { setOkMsg(""); setMsg(""); setResetUser(u); }}>
                        <KeyRound />
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => toggleActive(u)}>
                        {u.is_active ? "Disable" : "Enable"}
                      </button>
                      <button className="iconBtn danger" title="Delete employee" aria-label={`Delete ${u.display_name || u.username}`}
                        onClick={() => { setOkMsg(""); setMsg(""); setDelTarget(u); }}>
                        <Trash2 />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ marginTop: 12 }}>Scores and CEFR levels come from real AI assessments.</p>
        </div>

        {/* ADMIN STATISTICS — kept separate */}
        <div className="panel">
          <div className="panelHead">
            <h2>Admin statistics</h2>
            <span className="muted">The admin's own practice — never mixed with employee data</span>
          </div>
          <div className="tableWrap">
            <table>
              <thead>
                <tr><th>Admin</th><th>Conversations</th><th>Assessments</th><th>Avg score</th><th>Level</th><th>Practice</th><th>Last active</th></tr>
              </thead>
              <tbody>
                {admins.length === 0 && <tr><td colSpan={7} className="emptyCell">No admin practice yet.</td></tr>}
                {admins.map((a) => (
                  <tr key={a.id} className="clickRow" onClick={() => nav(`/admin/employees/${a.id}`)}>
                    <td><span className="nameCell"><UserBadge name={a.display_name || "Admin"} strong /><span className="tag admin">admin</span>{a.employee_id && <span className="empId">{a.employee_id}</span>}</span></td>
                    <td>{a.conversations}</td>
                    <td>{a.assessments}</td>
                    <td>{a.avg_score ?? "—"}</td>
                    <td>{a.latest_level ? <span className="cefr">{a.latest_level}</span> : "—"}</td>
                    <td>{fmtTime(a.practice_seconds)}</td>
                    <td>{fmtDate(a.latest_activity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Grading scale explainer */}
        <div className="panel">
          <h2>Grading scale (CEFR)</h2>
          <p className="muted" style={{ margin: "-6px 0 16px" }}>What each level means for an employee's spoken Hindi.</p>
          <GradeScale />
        </div>

        {/* SECONDARY: business overview */}
        {overview && (
          <details className="bizPanel">
            <summary>Business overview · usage &amp; cost</summary>
            <div className="statGrid" style={{ marginTop: 16 }}>
              <Stat icon={<Users />} v={String(overview.total_users)} l="Total accounts" />
              <Stat icon={<MessagesSquare />} v={String(overview.total_conversations)} l="Conversations" />
              <Stat icon={<ClipboardCheck />} v={String(overview.total_assessments)} l="Assessments" />
              <Stat icon={<Clock />} v={fmtTime(overview.total_practice_seconds)} l="Practice time" />
              <Stat icon={<Wallet />} v={`₹${overview.total_cost.toFixed(2)}`} l="Est. AI cost" />
            </div>
          </details>
        )}
      </div>

      {resetUser && (
        <ResetPasswordModal
          user={resetUser}
          onClose={() => setResetUser(null)}
          onDone={(name) => { setResetUser(null); setOkMsg(`Password reset for ${name}.`); }}
        />
      )}

      {addOpen && (
        <AddEmployeeModal
          onClose={() => setAddOpen(false)}
          onDone={(name) => { setAddOpen(false); setOkMsg(`Employee "${name}" added. Share their password with them privately.`); load(); }}
        />
      )}

      {delTarget && (
        <ConfirmDeleteModal
          name={delTarget.display_name || delTarget.username}
          onCancel={() => setDelTarget(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}

function ConfirmDeleteModal({
  name, onCancel, onConfirm,
}: {
  name: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const submit = async () => { setBusy(true); await onConfirm(); };

  return (
    <div className="backdrop" onClick={onCancel}>
      <div className="modal modalSm" onClick={(e) => e.stopPropagation()}>
        <div className="modalHead">
          <div className="modalTitle">Delete employee</div>
          <button type="button" className="iconBtn" onClick={onCancel} aria-label="Close"><X size={18} /></button>
        </div>
        <p className="muted" style={{ margin: "6px 0 0", fontSize: 14, lineHeight: 1.6 }}>
          Delete <b style={{ color: "var(--ink)" }}>{name}</b> and all of their conversations, scores, and
          assessments? This can't be undone.
        </p>
        <div className="loginActions">
          <button className="btn btn-danger btn-block btn-lg" onClick={submit} disabled={busy}>
            {busy ? "Deleting…" : "Delete employee"}
          </button>
          <button type="button" className="btn btn-secondary btn-block" onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function AddEmployeeModal({ onClose, onDone }: { onClose: () => void; onDone: (name: string) => void }) {
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) { setErr("Please enter the employee's name."); return; }
    if (pw.length < 6) { setErr("Password must be at least 6 characters."); return; }
    setBusy(true);
    setErr("");
    try {
      await api.createUser({ username: n, display_name: n, password: pw, role: "employee" });
      onDone(n);
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="backdrop" onClick={onClose}>
      <form className="modal modalSm" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modalHead">
          <div>
            <div className="modalTitle">Add employee</div>
            <p className="muted" style={{ margin: "6px 0 0", fontSize: 14 }}>
              Create an account for a new employee. They'll sign in by picking their name and entering this password.
            </p>
          </div>
          <button type="button" className="iconBtn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <label className="field">Employee name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoFocus />
        <label className="field">Password</label>
        <PasswordInput value={pw} onChange={setPw} placeholder="At least 6 characters" autoComplete="new-password" />
        {err && <div className="alert err formError">{err}</div>}
        <div className="loginActions">
          <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy || !name.trim() || pw.length < 6}>
            {busy ? "Adding…" : "Add employee"}
          </button>
          <button type="button" className="btn btn-secondary btn-block" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

function ResetPasswordModal({
  user, onClose, onDone,
}: {
  user: UserMetrics;
  onClose: () => void;
  onDone: (name: string) => void;
}) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const name = user.display_name || user.username;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.length < 6) { setErr("Password must be at least 6 characters."); return; }
    setBusy(true);
    setErr("");
    try {
      await api.updateUser(user.id, { password: pw });
      onDone(name);
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="backdrop" onClick={onClose}>
      <form className="modal modalSm" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modalHead">
          <div>
            <div className="modalTitle">Reset password</div>
            <p className="muted" style={{ margin: "6px 0 0", fontSize: 14 }}>
              Set a new password for <b style={{ color: "var(--ink)" }}>{name}</b>. Share it with them privately.
            </p>
          </div>
          <button type="button" className="iconBtn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <label className="field">New password</label>
        <PasswordInput value={pw} onChange={setPw} placeholder="At least 6 characters" autoFocus autoComplete="new-password" />
        {err && <div className="alert err formError">{err}</div>}
        <div className="loginActions">
          <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy || pw.length < 6}>
            {busy ? "Saving…" : "Reset password"}
          </button>
          <button type="button" className="btn btn-secondary btn-block" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

function Stat({ icon, v, l }: { icon?: ReactNode; v: string; l: string }) {
  return (
    <div className="stat">
      {icon && <div className="statIcon">{icon}</div>}
      <div className="v">{v}</div>
      <div className="l">{l}</div>
    </div>
  );
}
