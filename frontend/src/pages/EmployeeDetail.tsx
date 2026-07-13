import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, LineChart, LogOut } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import Brand from "../components/Brand";
import GradeScale from "../components/GradeScale";
import type { EmployeeDetail as Detail } from "../types";
import { fmtDate, fmtTime } from "../format";

export default function EmployeeDetail() {
  const { id } = useParams();
  const { logout } = useAuth();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (id) api.adminUserDetail(Number(id)).then(setD).catch((e) => setErr((e as Error).message));
  }, [id]);

  const maxScore = d ? Math.max(100, ...d.history.map((h) => h.score)) : 100;

  return (
    <div className="app">
      <header className="topbar">
        <Brand size="md" sub="Employee dashboard" />
        <div className="topActions">
          <Link className="btn btn-secondary btn-sm" to="/admin"><ArrowLeft /> All employees</Link>
          <button className="btn btn-secondary btn-sm" onClick={logout}><LogOut /> Sign out</button>
        </div>
      </header>

      <div className="page">
        {err && <div className="banner">{err}</div>}
        {!d ? (
          <div className="loadingRow"><span className="spinner" /> Loading employee…</div>
        ) : (
          <>
            <div className="empHeader">
              <div className="empAvatar">{(d.user.display_name || d.user.username).charAt(0).toUpperCase()}</div>
              <div>
                <h1 style={{ margin: 0, fontSize: 24 }}>{d.user.display_name || d.user.username}</h1>
                <div className="muted">
                  {d.user.is_active ? "Active" : "Disabled"} · joined {fmtDate(d.user.created_at)} · last active {fmtDate(d.user.last_login_at)}
                </div>
              </div>
              <div className="empHeaderScore">
                <div className="scoreBig">{d.metrics.avg_score ?? "—"}</div>
                <div className="muted">avg score{d.metrics.latest_level ? ` · ${d.metrics.latest_level}` : ""}</div>
              </div>
            </div>

            <div className="statGrid" style={{ marginBottom: 20 }}>
              <Stat v={String(d.metrics.conversations)} l="Conversations" />
              <Stat v={String(d.metrics.assessments)} l="Assessments" />
              <Stat v={fmtTime(d.metrics.practice_seconds)} l="Total time" />
              <Stat v={d.metrics.latest_level ?? "—"} l="Current level" />
              <Stat v={d.metrics.total_tokens.toLocaleString()} l="Tokens" />
              <Stat v={`₹${d.metrics.estimated_cost.toFixed(2)}`} l="Est. cost" />
            </div>

            <div className="panel">
              <h2>Improvement history</h2>
              {d.history.length === 0 ? (
                <div className="emptyState">
                  <span className="esIcon"><LineChart /></span>
                  <span className="esTitle">No assessments yet</span>
                  <span className="esText">History appears once this employee completes assessments.</span>
                </div>
              ) : (
                <div className="chart">
                  {d.history.map((h, i) => (
                    <div className="chartBar" key={i} title={`${Math.round(h.score)} (${h.level}) · ${fmtDate(h.date)}`}>
                      <div className="chartFill" style={{ height: `${(h.score / maxScore) * 100}%` }}>
                        <span className="chartVal">{Math.round(h.score)}</span>
                      </div>
                      <span className="chartLbl">{h.level}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="panel">
              <h2>Conversations &amp; assessments</h2>
              <div className="tableWrap">
                <table>
                  <thead>
                    <tr><th>Persona</th><th>Started</th><th>Live score</th><th>Assessment</th><th>Level</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {d.conversations.length === 0 && <tr><td colSpan={6} className="emptyCell">No conversations yet.</td></tr>}
                    {d.conversations.map((c) => (
                      <tr key={c.id}>
                        <td><b>{c.persona_label}</b></td>
                        <td>{fmtDate(c.started_at)}</td>
                        <td>{c.live_score == null ? "—" : Math.round(c.live_score)}</td>
                        <td>{c.assessment_score == null ? "—" : Math.round(c.assessment_score)}</td>
                        <td>{(c.assessment_level ?? c.live_level) ? <span className="cefr">{c.assessment_level ?? c.live_level}</span> : "—"}</td>
                        <td>{c.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="panel">
              <h2>What the grades mean (CEFR)</h2>
              <GradeScale />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ v, l }: { v: string; l: string }) {
  return (
    <div className="stat">
      <div className="v">{v}</div>
      <div className="l">{l}</div>
    </div>
  );
}
