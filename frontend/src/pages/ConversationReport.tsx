import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Printer, MessageSquare, Sparkles } from "lucide-react";
import { api } from "../api";
import Brand from "../components/Brand";
import ProfileMenu from "../components/ProfileMenu";
import { Dim, FbCard } from "../components/assessmentUi";
import type { Assessment, ConversationReport as Report } from "../types";
import { fmtDate, fmtTime } from "../format";

const GRADE_TITLE: Record<string, string> = {
  A1: "Beginner", A2: "Elementary", B1: "Intermediate",
  B2: "Upper-Intermediate", C1: "Advanced", C2: "Proficient",
};

export default function ConversationReport() {
  const { cid } = useParams();
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState("");
  const [generating, setGenerating] = useState(false);

  const load = () => {
    if (!cid) return;
    api.conversationReport(Number(cid)).then(setR).catch((e) => setErr((e as Error).message));
  };
  useEffect(load, [cid]);

  const generate = async () => {
    if (!cid) return;
    setGenerating(true);
    setErr("");
    try {
      await api.generateConversationAssessment(Number(cid));
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const backTo = r?.employee.id ? `/admin/employees/${r.employee.id}` : "/admin";

  return (
    <div className="app">
      <header className="topbar noPrint">
        <div className="topLeft">
          <Brand size="md" sub="Conversation report" />
          <span className="topDivider" />
          <Link className="btn btn-secondary btn-sm" to={backTo}><ArrowLeft /> Back to employee</Link>
        </div>
        <div className="topActions">
          <button className="btn btn-secondary btn-sm" onClick={() => window.print()}><Printer /> Print</button>
          <ProfileMenu />
        </div>
      </header>

      <div className="page report">
        {err && <div className="banner noPrint">{err}</div>}
        {!r ? (
          <div className="loadingRow"><span className="spinner" /> Loading report…</div>
        ) : (
          <>
            <ReportHero r={r} />
            <MetaGrid r={r} />
            <AssessmentSection
              assessment={r.assessment}
              onGenerate={generate}
              generating={generating}
              hasUserTurns={r.stats.user_messages > 0}
            />
            <Transcript r={r} />
          </>
        )}
      </div>
    </div>
  );
}

function ReportHero({ r }: { r: Report }) {
  const c = r.conversation;
  const a = r.assessment;
  const empName = r.employee.display_name || r.employee.username || "Employee";
  const score = a ? Math.round(a.overall_score) : c.live_score != null ? Math.round(c.live_score) : null;
  const grade = a?.cefr_level ?? c.live_level ?? null;
  const accent = c.persona_accent || "var(--accent)";

  return (
    <div className="reportHero">
      <div className="reportHeroMain">
        <span className="reportPersona" style={{ background: accent }}>
          <span className="reportPersonaEmoji">{c.persona_emoji || "💬"}</span>
        </span>
        <div className="reportText">
          <div className="reportKicker">Conversation report</div>
          <h1 className="reportTitle">
            Practice with <span className="hi">{c.persona_label}</span>
          </h1>
          <div className="reportSubline">
            <b>{empName}</b>
            {r.employee.employee_id && <span className="empId">{r.employee.employee_id}</span>}
            <span className="dotSep">·</span>
            <span>{a ? `Assessed ${fmtDate(a.created_at)}` : "Not yet assessed"}</span>
          </div>
        </div>
      </div>

      <div className="reportScoreBox" data-assessed={!!a}>
        <div className="reportScoreNum">{score ?? "—"}<span className="reportScoreOf">/100</span></div>
        <div className="reportScoreLbl">{a ? "Overall score" : score != null ? "Live score" : "No score"}</div>
        {grade && (
          <div className="reportGrade">
            <span className="cefr lg">{grade}</span>
            <span className="reportGradeName">{GRADE_TITLE[grade] ?? ""}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function MetaGrid({ r }: { r: Report }) {
  const c = r.conversation;
  const s = r.stats;
  return (
    <div className="statGrid reportMeta">
      <Meta label="Date & time" v={fmtDate(c.started_at)} />
      <Meta label="Duration" v={c.duration_seconds != null ? fmtTime(c.duration_seconds) : "—"} />
      <Meta label="AI persona" v={c.persona_label} hi />
      <Meta label="Status" v={c.status} />
      <Meta label="Messages" v={`${s.message_count} (${s.user_messages} yours)`} />
      <Meta label="Words spoken" v={String(s.user_words)} />
    </div>
  );
}

function Meta({ label, v, hi }: { label: string; v: string; hi?: boolean }) {
  return (
    <div className="stat">
      <div className={`v${hi ? " hi" : ""}`}>{v}</div>
      <div className="l">{label}</div>
    </div>
  );
}

function AssessmentSection({
  assessment, onGenerate, generating, hasUserTurns,
}: {
  assessment: Assessment | null;
  onGenerate: () => void;
  generating: boolean;
  hasUserTurns: boolean;
}) {
  if (!assessment) {
    return (
      <div className="panel">
        <h2>Saved assessment</h2>
        <div className="emptyAssess">
          <span className="esIcon"><Sparkles /></span>
          <p>This conversation wasn’t assessed at the time.</p>
          {hasUserTurns ? (
            <button className="btn btn-primary" onClick={onGenerate} disabled={generating}>
              {generating ? <><span className="spinner" /> Generating…</> : "Generate assessment report"}
            </button>
          ) : (
            <p className="muted">There are no employee messages to assess.</p>
          )}
        </div>
      </div>
    );
  }
  const a = assessment;
  return (
    <div className="panel">
      <h2>Saved assessment</h2>
      {a.summary && <p className="summary">{a.summary}</p>}

      <div className="card" style={{ margin: "16px 0" }}>
        <Dim label="Fluency" value={a.fluency} />
        <Dim label="Grammar" value={a.grammar} />
        <Dim label="Vocabulary" value={a.vocabulary} />
        <Dim label="Coherence" value={a.coherence} />
        <Dim label="English mixing" value={a.code_mixing} />
        {a.pronunciation != null && <Dim label="Pronunciation" value={a.pronunciation} />}
      </div>

      <div className="grid2">
        <FbCard title="Strengths" items={a.strengths} tone="good" />
        <FbCard title="To improve" items={a.weaknesses} tone="warn" />
      </div>

      {a.corrections.length > 0 && (
        <div className="corrList">
          <h4>Corrections</h4>
          {a.corrections.map((c, i) => (
            <div key={i} className="corr">
              <div className="corrSaid hi">“{c.said}”</div>
              <div className="corrBetter hi">→ {c.better}</div>
              <div className="corrWhy">{c.why}</div>
            </div>
          ))}
        </div>
      )}

      {a.next_steps.length > 0 && <FbCard title="Next steps" items={a.next_steps} tone="info" />}
    </div>
  );
}

function Transcript({ r }: { r: Report }) {
  const empName = r.employee.display_name || r.employee.username || "Employee";
  const personaName = r.conversation.persona_label;
  const accent = r.conversation.persona_accent || "var(--accent)";
  return (
    <div className="panel">
      <h2><MessageSquare size={18} style={{ verticalAlign: "-3px", marginRight: 8 }} />Full transcript</h2>
      {r.messages.length === 0 ? (
        <div className="emptyCell">No messages.</div>
      ) : (
        <div className="transcript">
          {r.messages.map((m) => {
            const mine = m.role === "user";
            return (
              <div key={m.id} className={`tRow ${mine ? "me" : "ai"}`}>
                <span
                  className="tAvatar"
                  style={mine ? undefined : { background: accent }}
                >
                  {mine ? empName.charAt(0).toUpperCase() : (r.conversation.persona_emoji || "💬")}
                </span>
                <div className="tBody">
                  <div className="tWho">
                    {mine ? empName : <span className="hi">{personaName}</span>}
                  </div>
                  <div className="tBubble hi">{m.content}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

