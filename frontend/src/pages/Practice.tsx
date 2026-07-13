import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, Briefcase, Car, GraduationCap, Heart, Lightbulb, LogOut, MessageCircle,
  Mic, Play, Send, Smile, Square, Stethoscope, Store, User, X,
} from "lucide-react";
import { api, streamTurn } from "../api";
import { useAuth } from "../auth";
import { useSpeech } from "../hooks/useSpeech";
import Brand from "../components/Brand";
import UserBadge from "../components/UserBadge";
import type { Assessment, Message, Persona, TurnScore } from "../types";

type Phase = "idle" | "listening" | "thinking" | "speaking";
const PHASE_LABEL: Record<Phase, string> = {
  idle: "Ready", listening: "Listening…", thinking: "Thinking…", speaking: "Speaking…",
};

const PERSONA_ICON: Record<string, typeof Briefcase> = {
  friend: Smile, businessman: Briefcase, girlfriend: Heart, boyfriend: Heart, doctor: Stethoscope,
  teacher: GraduationCap, shopkeeper: Store, cabbie: Car,
};
function PIcon({ k, size = 18 }: { k: string; size?: number }) {
  const Ic = PERSONA_ICON[k] || MessageCircle;
  return <Ic size={size} />;
}

function sentencesFrom(text: string, fromIdx: number, final: boolean): [string[], number] {
  const out: string[] = [];
  let idx = fromIdx;
  for (let i = fromIdx; i < text.length; i++) {
    if ("।?!.".includes(text[i])) {
      const s = text.slice(idx, i + 1).trim();
      if (s) out.push(s);
      idx = i + 1;
    }
  }
  if (final) {
    const tail = text.slice(idx).trim();
    if (tail) out.push(tail);
    idx = text.length;
  }
  return [out, idx];
}

export default function Practice() {
  const { user, logout } = useAuth();
  const { listenOnce, stopListening, speak, cancelSpeech, speechSupported, provider } = useSpeech();

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [mode, setMode] = useState<string>("");
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [interim, setInterim] = useState("");
  const [streaming, setStreaming] = useState("");
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState<{ score: number | null; level: string | null }>({ score: null, level: null });
  const [lastTurn, setLastTurn] = useState<TurnScore | null>(null);
  const [apiError, setApiError] = useState("");
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [assessing, setAssessing] = useState(false);

  const runningRef = useRef(false);
  const processingRef = useRef(false);
  const emptyRef = useRef(0);
  const cidRef = useRef<number | null>(null);
  const personaRef = useRef<Persona | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.body.classList.add("lockScroll");
    return () => document.body.classList.remove("lockScroll");
  }, []);
  useEffect(() => {
    api.personas().then((p) => {
      setPersonas(p);
      if (p.length) setMode(p[0].key);
    });
  }, []);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streaming, interim, phase]);

  const persona = personas.find((p) => p.key === mode) || null;
  personaRef.current = persona;

  function armMic() {
    if (!runningRef.current || processingRef.current) return;
    if (!speechSupported) {
      setPhase("idle");
      return;
    }
    setPhase("listening");
    listenOnce({ onInterim: setInterim })
      .then((heard) => {
        setInterim("");
        if (!runningRef.current || processingRef.current) return;
        if (heard.text) {
          emptyRef.current = 0;
          void processTurn(heard.text, heard.pronunciation);
        } else {
          emptyRef.current += 1;
          if (emptyRef.current >= 4) {
            setPhase("idle");
            setApiError("Mic isn't picking up audio. In Chrome, allow the microphone — or type your reply below.");
          } else {
            armMic();
          }
        }
      })
      .catch(() => setPhase("idle"));
  }

  async function processTurn(text: string, pronunciation: number | null) {
    text = text.trim();
    if (!text || !cidRef.current || processingRef.current) return;
    processingRef.current = true;
    setBusy(true);
    stopListening();
    setDraft("");
    setApiError("");
    setMessages((m) => [...m, { id: -Date.now(), turn_index: -1, role: "user", content: text }]);
    setPhase("thinking");

    let full = "";
    let spokenIdx = 0;
    let chain = Promise.resolve();
    const voice = personaRef.current?.voice_config || null;
    const enqueue = (s: string) => {
      chain = chain.then(() => {
        if (!runningRef.current) return;
        setPhase("speaking");
        return speak(s, voice);
      });
    };
    const flush = (final: boolean) => {
      const [parts, idx] = sentencesFrom(full, spokenIdx, final);
      spokenIdx = idx;
      parts.forEach(enqueue);
    };

    try {
      await streamTurn(
        cidRef.current,
        text,
        {
          onDelta: (t) => { full += t; setStreaming(full); flush(false); },
          onDone: (msg) => { setStreaming(""); setMessages((m) => [...m, msg]); },
          onScore: (s) => { setLive({ score: s.live_score, level: s.live_level }); setLastTurn(s.turn as TurnScore); },
          onError: (d) => setApiError(d),
        },
        pronunciation
      );
    } catch (e) {
      setApiError((e as Error).message);
    }
    flush(true);
    await chain;
    processingRef.current = false;
    setBusy(false);
    armMic();
  }

  async function start() {
    if (!mode) return;
    setApiError("");
    setAssessment(null);
    setMessages([]);
    setLive({ score: null, level: null });
    setLastTurn(null);
    setDraft("");
    emptyRef.current = 0;
    processingRef.current = false;
    runningRef.current = true;
    try {
      const { conversation, opener } = await api.startConversation(mode);
      cidRef.current = conversation.id;
      setMessages([opener]);
      setActive(true);
      setPhase("speaking");
      await speak(opener.content, personaRef.current?.voice_config || null);
      armMic();
    } catch (e) {
      runningRef.current = false;
      setPhase("idle");
      setApiError((e as Error).message);
    }
  }

  function submitText(e: FormEvent) {
    e.preventDefault();
    const t = draft.trim();
    if (!t || processingRef.current) return;
    stopListening();
    void processTurn(t, null);
  }

  async function end() {
    runningRef.current = false;
    processingRef.current = false;
    stopListening();
    cancelSpeech();
    setActive(false);
    setBusy(false);
    setPhase("idle");
    if (cidRef.current) {
      try { await api.endConversation(cidRef.current); } catch { /* ignore */ }
    }
  }

  async function getAssessment() {
    if (!cidRef.current) return;
    setAssessing(true);
    setApiError("");
    try {
      setAssessment(await api.createAssessment(cidRef.current));
    } catch (e) {
      setApiError((e as Error).message);
    } finally {
      setAssessing(false);
    }
  }

  const hasUserTurns = messages.some((m) => m.role === "user");
  const accent = persona?.accent_color || "var(--accent)";

  return (
    <div className="convo">
      {/* ── LEFT RAIL ── */}
      <aside className="convoRail">
        <div className="railTop"><Brand size="md" /></div>

        <div className="railSection">
          <div className="railLabel">Signed in as</div>
          <UserBadge name={user?.display_name || user?.username || "You"} strong />
          {user?.role === "admin" && (
            <Link className="btn btn-secondary btn-sm btn-block" to="/admin" style={{ marginTop: 12 }}>
              <ArrowLeft /> Back to dashboard
            </Link>
          )}
        </div>

        <div className="railSection personaSection">
          <div className="railLabel">Choose a persona</div>
          <div className="personaList">
            {personas.map((p) => (
              <button
                key={p.key}
                className="personaItem"
                data-selected={p.key === mode}
                disabled={active}
                onClick={() => setMode(p.key)}
              >
                <span className="personaAvatar" style={{ background: p.accent_color || "var(--accent)" }}>
                  <PIcon k={p.key} />
                </span>
                <span className="personaMeta">
                  <div className="personaName">{p.label}</div>
                  <div className="personaDesc">{p.description}</div>
                </span>
              </button>
            ))}
          </div>
        </div>

        {!active && (
          <div className="railFoot">
            <button className="btn btn-ghost btn-block" onClick={logout}><LogOut /> Sign out</button>
          </div>
        )}
      </aside>

      {/* ── CENTER ── */}
      <main className="convoMain">
        <div className="convoHeader">
          {persona && (
            <div className="convoHeaderPersona">
              <span className="personaAvatar" style={{ background: accent }}><PIcon k={persona.key} /></span>
              <div>
                <div className="personaName">{persona.label}</div>
                <div className="personaDesc">{persona.description}</div>
              </div>
            </div>
          )}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
            <span className="muted" style={{ fontSize: 12 }}>{provider === "azure" ? "Azure voice" : "Browser voice"}</span>
            <span className="statusPill">
              <span className={`dot ${phase === "listening" ? "pulse" : ""}`} data-phase={phase} />
              {PHASE_LABEL[phase]}
            </span>
            {active && (
              <button className="btn btn-danger btn-sm" onClick={end}><Square /> End conversation</button>
            )}
          </div>
        </div>

        <div className="convoScroll" ref={scrollRef}>
          <div className="convoInner">
            {messages.length === 0 && !active ? (
              <div className="chatEmpty">
                <span className="esIcon"><Mic /></span>
                <h3>Start a conversation</h3>
                <p>Pick a persona on the left and press Start. Speak in Hindi — the mic opens automatically after
                  each reply, and your live score updates on the right. You can also type.</p>
              </div>
            ) : (
              <>
                {messages.map((m, i) => (
                  <div key={i} className={`msgRow ${m.role === "user" ? "me" : ""}`}>
                    <span
                      className={`msgAvatar ${m.role === "user" ? "me" : "bot"}`}
                      style={m.role !== "user" ? { background: accent } : undefined}
                    >
                      {m.role === "user" ? <User size={16} /> : <PIcon k={mode} size={16} />}
                    </span>
                    <div className={`bubble ${m.role === "user" ? "me" : "bot"}`}>{m.content}</div>
                  </div>
                ))}
                {interim && (
                  <div className="msgRow me">
                    <span className="msgAvatar me"><User size={16} /></span>
                    <div className="bubble interim">{interim}…</div>
                  </div>
                )}
                {streaming && (
                  <div className="msgRow">
                    <span className="msgAvatar bot" style={{ background: accent }}><PIcon k={mode} size={16} /></span>
                    <div className="bubble bot">{streaming}</div>
                  </div>
                )}
                {phase === "thinking" && !streaming && (
                  <div className="msgRow">
                    <span className="msgAvatar bot" style={{ background: accent }}><PIcon k={mode} size={16} /></span>
                    <div className="bubble bot"><span className="typing"><span /><span /><span /></span></div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="convoComposer">
          <div className="composerInner">
            {apiError && <div className="banner" style={{ marginBottom: 12 }}>{apiError}</div>}
            {!active ? (
              <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
                <button className="startBtn" onClick={start} disabled={!mode}><Play /> Start conversation</button>
                {hasUserTurns && (
                  <button className="btn btn-secondary btn-lg" onClick={getAssessment} disabled={assessing}>
                    {assessing ? <><span className="spinner" /> Generating…</> : "View full assessment"}
                  </button>
                )}
              </div>
            ) : (
              <form className="composerBar" onSubmit={submitText}>
                <button
                  type="button"
                  className={`micRound ${phase === "listening" ? "on" : ""}`}
                  onClick={() => { emptyRef.current = 0; setApiError(""); if (!processingRef.current) armMic(); }}
                  disabled={busy || !speechSupported}
                  aria-label="Microphone"
                >
                  <Mic />
                </button>
                <input
                  className="hindi"
                  placeholder={phase === "listening" ? "Listening — speak now…" : "Or type in Hindi…"}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  disabled={busy}
                />
                <button className="sendRound" type="submit" disabled={busy || !draft.trim()} aria-label="Send">
                  <Send />
                </button>
              </form>
            )}
            {active && <div className="composerHint">The mic reopens automatically after each reply — just talk.</div>}
          </div>
        </div>
      </main>

      {/* ── RIGHT RAIL ── */}
      <aside className="convoRail right">
        <div className="railTop">
          <div className="railLabel">Live evaluation</div>
          <div className="scoreHero">
            <span className="scoreBig">{live.score == null ? "—" : Math.round(live.score)}</span>
            <span className="scoreOutOf">/ 100</span>
            {live.level && <span className="cefr">{live.level}</span>}
          </div>
          <div className="scoreCaption">Updates every turn as you speak</div>
        </div>

        <div className="railSection">
          <div className="railLabel">Skills</div>
          <Dim label="Fluency" value={lastTurn?.fluency ?? null} />
          <Dim label="Grammar" value={lastTurn?.grammar ?? null} />
          <Dim label="Vocabulary" value={lastTurn?.vocabulary ?? null} />
          <Dim label="Coherence" value={lastTurn?.coherence ?? null} />
          {lastTurn?.pronunciation != null && <Dim label="Pronunciation" value={lastTurn.pronunciation} />}
        </div>

        <div className="railSection">
          <div className="railLabel">Coaching tip</div>
          {lastTurn?.notes ? (
            <div className="tipBox"><Lightbulb />{lastTurn.notes}</div>
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>Tips appear here as the conversation progresses.</p>
          )}
        </div>

        {!active && hasUserTurns && (
          <div className="railFoot">
            <button className="btn btn-primary btn-block" onClick={getAssessment} disabled={assessing}>
              {assessing ? <><span className="spinner" /> Generating…</> : "View full assessment"}
            </button>
          </div>
        )}
      </aside>

      {assessment && <AssessmentModal a={assessment} onClose={() => setAssessment(null)} />}
    </div>
  );
}

function Dim({ label, value }: { label: string; value: number | null }) {
  const v = value ?? 0;
  return (
    <div className="dim">
      <div className="dimTop">
        <span className="dname">{label}</span>
        <span className="dval">{value == null ? "—" : Math.round(v)}</span>
      </div>
      <div className="track"><div className="fill" style={{ width: `${v}%` }} /></div>
    </div>
  );
}

function AssessmentModal({ a, onClose }: { a: Assessment; onClose: () => void }) {
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modalHead">
          <div>
            <div className="modalTitle">Assessment</div>
            <div className="scoreHero" style={{ marginTop: 6 }}>
              <span className="bigScore">{Math.round(a.overall_score)}</span>
              <span className="scoreOutOf">/ 100</span>
              <span className="cefr lg">{a.cefr_level}</span>
            </div>
          </div>
          <button className="iconBtn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {a.summary && <p className="summary">{a.summary}</p>}

        <div className="card" style={{ marginBottom: 16 }}>
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
                <div className="corrSaid">“{c.said}”</div>
                <div className="corrBetter">→ {c.better}</div>
                <div className="corrWhy">{c.why}</div>
              </div>
            ))}
          </div>
        )}

        {a.next_steps.length > 0 && <FbCard title="Next steps" items={a.next_steps} tone="info" />}
      </div>
    </div>
  );
}

function FbCard({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  if (!items.length) return null;
  return (
    <div className={`fbCard ${tone}`}>
      <h4>{title}</h4>
      <ul>{items.map((it, i) => <li key={i}>{it}</li>)}</ul>
    </div>
  );
}
