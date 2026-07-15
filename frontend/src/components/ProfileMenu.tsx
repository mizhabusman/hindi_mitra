import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, KeyRound, LogOut, User, UserCog, X } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import PasswordInput from "./PasswordInput";

// Shared admin account menu — lives in the top-right of every admin page.
export default function ProfileMenu() {
  const { user, logout, refresh } = useAuth();
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<null | "name" | "password">(null);
  const ref = useRef<HTMLDivElement>(null);
  const name = user?.display_name || user?.username || "Admin";

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="profileMenu" ref={ref}>
      <button className="profileTrigger" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <span className="profileAvatar"><User size={16} /></span>
        <span className="profileId">
          <span className="profileName">{name}</span>
          <span className="profileRole">Administrator</span>
        </span>
        <ChevronDown size={16} className="profileChevron" data-open={open} />
      </button>
      {open && (
        <div className="profilePop" role="menu">
          <div className="profilePopHead">
            <span className="profileAvatar lg"><User size={18} /></span>
            <span className="profileId">
              <span className="profileName">{name}</span>
              <span className="profileRole">Administrator</span>
            </span>
          </div>
          <button className="menuItem" onClick={() => { setOpen(false); setModal("name"); }}>
            <UserCog /> Change name
          </button>
          <button className="menuItem" onClick={() => { setOpen(false); setModal("password"); }}>
            <KeyRound /> Change password
          </button>
          <div className="profilePopSep" />
          <button className="menuItem danger" onClick={logout}><LogOut /> Sign out</button>
        </div>
      )}

      {modal === "name" && user && (
        <ChangeNameModal
          userId={user.id}
          current={name}
          onClose={() => setModal(null)}
          onDone={async () => { await refresh(); setModal(null); }}
        />
      )}
      {modal === "password" && user && (
        <ChangePasswordModal userId={user.id} onClose={() => setModal(null)} onDone={() => setModal(null)} />
      )}
    </div>
  );
}

function ChangeNameModal({
  userId, current, onClose, onDone,
}: {
  userId: number;
  current: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) { setErr("Please enter a name."); return; }
    setBusy(true);
    setErr("");
    try {
      await api.updateUser(userId, { display_name: n });
      onDone();
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="backdrop" onClick={onClose}>
      <form className="modal modalSm" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modalHead">
          <div className="modalTitle">Change name</div>
          <button type="button" className="iconBtn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <label className="field">Display name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoFocus />
        {err && <div className="alert err formError">{err}</div>}
        <div className="loginActions">
          <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy || !name.trim()}>
            {busy ? "Saving…" : "Save name"}
          </button>
          <button type="button" className="btn btn-secondary btn-block" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function ChangePasswordModal({
  userId, onClose, onDone,
}: {
  userId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.length < 6) { setErr("Password must be at least 6 characters."); return; }
    if (pw !== pw2) { setErr("The passwords don't match."); return; }
    setBusy(true);
    setErr("");
    try {
      await api.updateUser(userId, { password: pw });
      onDone();
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="backdrop" onClick={onClose}>
      <form className="modal modalSm" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modalHead">
          <div className="modalTitle">Change password</div>
          <button type="button" className="iconBtn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <label className="field">New password</label>
        <PasswordInput value={pw} onChange={setPw} placeholder="At least 6 characters" autoFocus autoComplete="new-password" />
        <label className="field">Confirm password</label>
        <PasswordInput value={pw2} onChange={setPw2} placeholder="Re-enter the password" autoComplete="new-password" />
        {err && <div className="alert err formError">{err}</div>}
        <div className="loginActions">
          <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={busy || pw.length < 6}>
            {busy ? "Saving…" : "Update password"}
          </button>
          <button type="button" className="btn btn-secondary btn-block" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
