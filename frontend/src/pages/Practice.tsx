import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  Activity, ArrowLeft, Briefcase, Car, GraduationCap, Heart, History, LogOut, MessageCircle,
  Mic, Play, Send, Smile, Sparkles, Square, Stethoscope, Store, User, X,
} from "lucide-react";
import { api, streamTurn } from "../api";
import { useAuth } from "../auth";
import { useSpeech } from "../hooks/useSpeech";
import Brand from "../components/Brand";
import { Dim, FbCard } from "../components/assessmentUi";
import {
  getEndOfSpeechMs, setEndOfSpeechMs,
  END_OF_SPEECH_MIN_MS, END_OF_SPEECH_MAX_MS, END_OF_SPEECH_STEP_MS,
} from "../speech/config";
import type { Assessment, Coach, Message, Persona, TurnScore } from "../types";

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
  // A conversation was just ended this session and is still on screen — the ONLY
  // moment "Continue previous" is offered. Cleared the instant the user moves on
  // (start new / switch persona / leave), after which it's a finalized record.
  const [ended, setEnded] = useState(false);
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [interim, setInterim] = useState("");
  const [streaming, setStreaming] = useState("");
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState<{ score: number | null; level: string | null }>({ score: null, level: null });
  const [lastTurn, setLastTurn] = useState<TurnScore | null>(null);
  const [coach, setCoach] = useState<Coach | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  // Live coach on/off — remembered across sessions. Off skips the per-turn AI
  // call entirely (no cost); the end-of-conversation assessment is unaffected.
  const [liveCoach, setLiveCoach] = useState(() => localStorage.getItem("hb_live_coach") !== "off");
  // End-of-speech wait (how long we pause after the user stops before responding).
  // Saved per person; both speech providers read it fresh on the next mic-open.
  const [eosMs, setEosMs] = useState(getEndOfSpeechMs());
  const bumpEos = (delta: number) => setEosMs(setEndOfSpeechMs(eosMs + delta));
  const [apiError, setApiError] = useState("");
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [showAssessment, setShowAssessment] = useState(false);
  const [assessing, setAssessing] = useState(false);

  const runningRef = useRef(false);
  const liveCoachRef = useRef(liveCoach);
  liveCoachRef.current = liveCoach;
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
    localStorage.setItem("hb_live_coach", liveCoach ? "on" : "off");
    if (!liveCoach) setAnalyzing(false);
  }, [liveCoach]);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streaming, interim, phase]);

  // End the conversation if the user closes the tab or navigates away without
  // pressing "End" — otherwise it lingers forever as an "active" session.
  useEffect(() => {
    const endActive = () => {
      const id = cidRef.current;
      if (!runningRef.current || !id) return;
      runningRef.current = false;
      const url = `/api/conversations/${id}/end`;
      if (navigator.sendBeacon) navigator.sendBeacon(url);
      else fetch(url, { method: "POST", credentials: "include", keepalive: true }).catch(() => {});
    };
    window.addEventListener("pagehide", endActive);
    return () => {
      window.removeEventListener("pagehide", endActive);
      endActive();  // covers in-app navigation away from the practice screen
    };
  }, []);

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

  async function processTurn(text: string, pronunciation: number | null, hidden = false) {
    text = text.trim();
    if (!text || !cidRef.current || processingRef.current) return;
    processingRef.current = true;
    setBusy(true);
    stopListening();
    setDraft("");
    setApiError("");
    setMessages((m) => [...m, { id: -Date.now(), turn_index: -1, role: "user", content: text, hidden }]);
    setPhase("thinking");
    // Fresh coaching for THIS reply — clear the previous card and show analyzing
    // (only when the live coach is on; otherwise no per-turn AI call happens).
    const useCoach = liveCoachRef.current;
    if (useCoach) {
      setCoach(null);
      setAnalyzing(true);
    }

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
          onScore: (s) => {
            setLive({ score: s.live_score, level: s.live_level });
            setLastTurn(s.turn as TurnScore);
            if (s.coach) setCoach(s.coach);
            setAnalyzing(false);
          },
          onError: (d) => setApiError(d),
        },
        pronunciation,
        useCoach
      );
    } catch (e) {
      setApiError((e as Error).message);
    }
    flush(true);
    await chain;
    setAnalyzing(false);  // fallback: clear the analyzing state even if scoring failed
    processingRef.current = false;
    setBusy(false);
    armMic();
  }

  // Wipe the on-screen conversation back to a clean slate (used when the user
  // moves on from a just-ended conversation — start new / switch persona).
  function clearConversation() {
    setEnded(false);
    setMessages([]);
    cidRef.current = null;
    setAssessment(null);
    setShowAssessment(false);
    setLive({ score: null, level: null });
    setLastTurn(null);
    setCoach(null);
    setAnalyzing(false);
    setDraft("");
  }

  async function start() {
    if (!mode || starting) return;  // guard against double-click double-start
    setStarting(true);
    setApiError("");
    setEnded(false);
    setAssessment(null);
    setShowAssessment(false);
    setMessages([]);
    setLive({ score: null, level: null });
    setLastTurn(null);
    setCoach(null);
    setAnalyzing(false);
    setDraft("");
    emptyRef.current = 0;
    processingRef.current = false;
    runningRef.current = true;
    try {
      const { conversation, opener } = await api.startConversation(mode);
      cidRef.current = conversation.id;
      setMessages([opener]);
      setActive(true);
      setStarting(false);
      setPhase("speaking");
      await speak(opener.content, personaRef.current?.voice_config || null);
      armMic();
    } catch (e) {
      runningRef.current = false;
      setStarting(false);
      setPhase("idle");
      setApiError((e as Error).message);
    }
  }

  // Continue the just-ended conversation (same conversation row). Only reachable
  // while `ended` is true — i.e. still on that conversation's screen.
  async function continuePrev() {
    if (!cidRef.current || starting) return;
    setStarting(true);
    setApiError("");
    setAssessment(null);   // the old report is discarded server-side on resume
    setShowAssessment(false);
    setLastTurn(null);
    setCoach(null);
    setAnalyzing(false);
    setDraft("");
    emptyRef.current = 0;
    processingRef.current = false;
    runningRef.current = true;
    try {
      const { conversation, messages } = await api.resumeConversation(cidRef.current);
      cidRef.current = conversation.id;
      setMessages(messages);
      setLive({ score: conversation.live_score, level: conversation.live_level });
      setEnded(false);
      setActive(true);
      setStarting(false);
      setPhase("idle");  // no new opener — pick up where the conversation left off
      armMic();
    } catch (e) {
      runningRef.current = false;
      setStarting(false);
      setPhase("idle");
      setApiError((e as Error).message);
    }
  }

  function submitText(e: FormEvent) {
    e.preventDefault();
    let t = draft.trim();
    if (!t || processingRef.current) return;
    // Examiner shortcut: a message typed as "/hide <instruction>" is sent to
    // the AI but not shown in the chat, so the candidate doesn't see the setup.
    const hidden = /^\/hide\b\s*/i.test(t);
    if (hidden) t = t.replace(/^\/hide\b\s*/i, "").trim();
    if (!t) return;
    stopListening();
    void processTurn(t, null, hidden);
  }

  async function end() {
    runningRef.current = false;
    processingRef.current = false;
    stopListening();
    cancelSpeech();
    setActive(false);
    setBusy(false);
    setPhase("idle");
    const hadUserTurn = messages.some((m) => m.role === "user");
    if (cidRef.current) {
      try { await api.endConversation(cidRef.current); } catch { /* ignore */ }
    }
    if (hadUserTurn) {
      // Saved as one conversation; stay on it so the user can Continue or assess.
      setEnded(true);
    } else {
      // No user reply → the backend dropped it; nothing to keep on screen.
      clearConversation();
    }
  }

  // Generate the assessment once, then cache it. Re-opening only shows the
  // cached report — it never regenerates (no extra cost, no score drift).
  async function generateAssessment() {
    if (!cidRef.current || assessing) return;
    setAssessing(true);
    setApiError("");
    try {
      setAssessment(await api.createAssessment(cidRef.current));
      setShowAssessment(true);
    } catch (e) {
      setApiError((e as Error).message);
    } finally {
      setAssessing(false);
    }
  }

  function openAssessment() {
    if (assessment) setShowAssessment(true);  // already generated — just view it
    else void generateAssessment();           // first time — generate + open
  }

  const accent = persona?.accent_color || "var(--accent)";

  return (
    <div className="convo">
      {/* ── LEFT RAIL ── */}
      <aside className="convoRail">
        <div className="railTop"><Brand size="md" /></div>

        <div className="railSection personaSection">
          <div className="railLabel">Choose a persona</div>
          <div className="personaList">
            {personas.map((p) => (
              <button
                key={p.key}
                className="personaItem"
                data-selected={p.key === mode}
                disabled={active}
                onClick={() => {
                  if (p.key === mode) return;
                  if (ended) clearConversation();  // moving on finalizes the ended convo
                  setMode(p.key);
                }}
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

        <div className="railFoot">
          <div className="acctCard">
            <div className="acctId">
              <span className="acctAvatar"><User size={18} /></span>
              <div className="acctMeta">
                <span className="acctName">{user?.display_name || user?.username || "You"}</span>
                <span className="acctRole">{user?.role === "admin" ? "Administrator" : "Employee"}</span>
              </div>
            </div>
            {user?.role === "admin" && (
              <Link className="btn btn-ghost btn-block btn-sm" to="/admin"><ArrowLeft /> Back to dashboard</Link>
            )}
            <button className="btn btn-ghost btn-block btn-sm" onClick={logout}><LogOut /> Sign out</button>
          </div>
        </div>
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
          </div>
        </div>

        <div className="convoScroll" ref={scrollRef}>
          <div className="convoInner">
            {!active && !ended ? (
              <div className="chatEmpty">
                <span className="esIcon"><Mic /></span>
                <h3>Start a conversation</h3>
                <p>Pick a persona on the left and press Start. Speak in Hindi — the mic opens automatically after
                  each reply, and your live score updates on the right. You can also type.</p>
              </div>
            ) : (
              <>
                {messages.map((m, i) => (
                  m.hidden ? null : (
                  <div key={i} className={`msgRow ${m.role === "user" ? "me" : ""}`}>
                    <span
                      className={`msgAvatar ${m.role === "user" ? "me" : "bot"}`}
                      style={m.role !== "user" ? { background: accent } : undefined}
                    >
                      {m.role === "user" ? <User size={16} /> : <PIcon k={mode} size={16} />}
                    </span>
                    <div className={`bubble ${m.role === "user" ? "me" : "bot"}`}>{m.content}</div>
                  </div>
                  )
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
              <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
                <button
                  className={`startBtn ${starting ? "starting" : ""}`}
                  onClick={start}
                  disabled={!mode || starting}
                >
                  {starting
                    ? <><span className="spinner btnSpinner" /> Starting…</>
                    : <><Play /> {ended ? "Start new conversation" : "Start conversation"}</>}
                </button>
                {ended && (
                  <button className="btn btn-secondary btn-lg" onClick={continuePrev} disabled={starting}>
                    <History /> Continue previous conversation
                  </button>
                )}
                {/* Fallback only for tablet widths where the right scoring card
                    (which normally holds this button) is hidden. Never shown on
                    desktop or mobile. */}
                {ended && (
                  <button className="btn btn-secondary btn-lg assessFallback" onClick={openAssessment} disabled={assessing}>
                    {assessing ? <><span className="spinner" /> Generating…</> : assessment ? "View assessment" : "Generate assessment"}
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
            {active && (
              <div className="composerFoot">
                <span className="composerHint">The mic reopens automatically after each reply — just talk.</span>
                <button className="btn btn-danger endBtn" onClick={end}><Square size={16} /> End conversation</button>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* ── RIGHT RAIL ── */}
      <aside className="convoRail right">
        <div className="railTop">
          <div className="railTopHead">
            <div className="railLabel">Live evaluation</div>
            <label className="switchWrap">
              <span className="switchLabel">Coach</span>
              <button
                type="button"
                className={`switch ${liveCoach ? "on" : ""}`}
                role="switch"
                aria-checked={liveCoach}
                aria-label="Toggle live coach"
                title={liveCoach ? "Live coach on — click to turn off (saves cost)" : "Live coach off — click to turn on"}
                onClick={() => setLiveCoach((v) => !v)}
              >
                <span className="switchKnob" />
              </button>
            </label>
          </div>
          <div className="scoreHero">
            <span className="scoreBig">{!liveCoach || live.score == null ? "—" : Math.round(live.score)}</span>
            <span className="scoreOutOf">/ 100</span>
            {liveCoach && live.level && <span className="cefr">{live.level}</span>}
          </div>
          <div className="scoreCaption">
            {liveCoach ? "Updates every turn as you speak" : "Live coach off · full assessment at the end"}
          </div>
          <div className="waitRow" title="How long the app waits after you stop speaking before it responds.">
            <span className="waitLabel">Response wait</span>
            <div className="stepper" role="group" aria-label="Response wait time">
              <button
                type="button"
                className="stepBtn"
                onClick={() => bumpEos(-END_OF_SPEECH_STEP_MS)}
                disabled={eosMs <= END_OF_SPEECH_MIN_MS}
                aria-label="Decrease response wait"
              >
                −
              </button>
              <span className="stepVal">{(eosMs / 1000).toFixed(1)}s</span>
              <button
                type="button"
                className="stepBtn"
                onClick={() => bumpEos(END_OF_SPEECH_STEP_MS)}
                disabled={eosMs >= END_OF_SPEECH_MAX_MS}
                aria-label="Increase response wait"
              >
                +
              </button>
            </div>
          </div>
        </div>

        <div className={`railSection analysisCard ${liveCoach && analyzing ? "analyzing" : ""}`}>
          <div className="railLabel">
            <Activity size={13} /> AI Analysis
            {liveCoach && analyzing && <span className="analyzingTag">analyzing<i /></span>}
          </div>
          <SkillDots t={liveCoach ? lastTurn : null} />
        </div>

        <div className="railSection coachSection">
          <div className="railLabel"><Sparkles size={13} /> AI Hindi Coach</div>
          <div className="coachScroll">
            <CoachCard coach={coach} analyzing={analyzing} score={lastTurn?.composite ?? null} enabled={liveCoach} />
          </div>
        </div>

        {!active && ended && (
          <div className="railFoot">
            <button className="btn btn-primary btn-block" onClick={openAssessment} disabled={assessing}>
              {assessing ? <><span className="spinner" /> Generating…</> : assessment ? "View assessment" : "Generate assessment"}
            </button>
          </div>
        )}
      </aside>

      {showAssessment && assessment && <AssessmentModal a={assessment} onClose={() => setShowAssessment(false)} />}
    </div>
  );
}

// Colour by score band (skill rings + coach heading) so quality reads instantly.
function toneClass(score: number | null): string {
  if (score == null) return "neutral";
  if (score >= 80) return "good";
  if (score >= 60) return "ok";
  if (score >= 45) return "warn";
  return "bad";
}
const TONE_COLOR: Record<string, string> = {
  good: "var(--success)", ok: "var(--accent)", warn: "var(--warn)", bad: "var(--danger)", neutral: "var(--border-2)",
};

// Four compact ring gauges in one row — the live "AI Analysis" of the last turn.
function SkillDots({ t }: { t: TurnScore | null }) {
  const items: [string, number | null][] = [
    ["Fluency", t?.fluency ?? null],
    ["Grammar", t?.grammar ?? null],
    ["Vocab", t?.vocabulary ?? null],
    ["Coherence", t?.coherence ?? null],
  ];
  return (
    <div className="skillDots">
      {items.map(([label, v]) => (
        <div className="skillDot" key={label}>
          <div className="ring" style={{ "--v": v ?? 0, "--tone": TONE_COLOR[toneClass(v)] } as CSSProperties}>
            <span className="ringVal">{v == null ? "—" : Math.round(v)}</span>
          </div>
          <span className="skillDotLabel">{label}</span>
        </div>
      ))}
    </div>
  );
}

function CoachCard({ coach, analyzing, score, enabled }: { coach: Coach | null; analyzing: boolean; score: number | null; enabled: boolean }) {
  if (!enabled) {
    return (
      <p className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
        Live coach is off to save cost. Turn it on (top-right) for instant per-reply feedback — you'll still get a full assessment when you end the conversation.
      </p>
    );
  }
  if (analyzing && !coach) {
    return <div className="coachLoading"><span className="spinner" /> Analyzing your reply…</div>;
  }
  if (!coach) {
    return (
      <p className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
        Speak or type a reply — your AI Hindi coach gives instant feedback here.
      </p>
    );
  }
  const hasSuggestion = !!coach.suggested_reply;
  return (
    <div className="coach">
      {coach.heading && (
        <div className={`coachHeading ${toneClass(score)}`}>
          <Sparkles size={14} /> <span>{coach.heading}</span>
        </div>
      )}
      {coach.assessment && <p className="coachText">{coach.assessment}</p>}

      {/* Compact You → Better comparison (or ✅ when already correct). */}
      <div className="coachCompare">
        <div className="cmpRow you">
          <span className="cmpTag">You</span>
          <span className="cmpText hindi">{coach.current_reply}</span>
        </div>
        {hasSuggestion ? (
          <div className="cmpRow better">
            <span className="cmpTag">Better</span>
            <span className="cmpText hindi">{coach.suggested_reply}</span>
          </div>
        ) : coach.is_correct ? (
          <>
            <div className="cmpOk">✅ Already natural &amp; correct</div>
            {coach.alternative && (
              <div className="cmpRow alt">
                <span className="cmpTag">Or</span>
                <span className="cmpText hindi">{coach.alternative}</span>
              </div>
            )}
          </>
        ) : null}
      </div>

      {hasSuggestion && coach.why_better && <p className="coachWhy">{coach.why_better}</p>}

      {coach.vocab.length > 0 && (
        <div className="vocab">
          <div className="coachLabel">Say it in Hindi</div>
          <div className="vocabChips">
            {coach.vocab.map((v, i) => (
              <span className="vocabChip" key={i}>
                <b>{v.english}</b><span className="vocabArrow">→</span><span className="hindi">{v.hindi}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AssessmentModal({ a, onClose }: { a: Assessment; onClose: () => void }) {
  // Close on Escape as well as backdrop click / the X button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal modalScroll" onClick={(e) => e.stopPropagation()}>
        {/* Fixed header — stays put while the body scrolls, so the close
            button is always reachable. */}
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

        <div className="modalScrollBody">
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
    </div>
  );
}
