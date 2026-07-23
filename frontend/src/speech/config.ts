// Shared speech-capture tuning — the single place to fine-tune how the app
// decides a spoken turn is finished, so behaviour is identical across both
// speech providers (browser Web Speech + Azure Speech).

// ── End-of-speech silence ────────────────────────────────────────────
// How long the speaker may pause before we treat the utterance as finished.
// This is a Hindi SPEAKING ASSESSMENT: users naturally pause to think mid-answer,
// so we wait a patient beat rather than cutting them off.
//
// This is user-adjustable in the UI (per person, saved in the browser). Both
// providers read getEndOfSpeechMs() fresh at the start of every mic-open, so a
// change takes effect on the very next turn — no restart, nothing else affected.
// The value is clamped to a safe range so recognition can never be broken by an
// extreme setting.
export const END_OF_SPEECH_DEFAULT_MS = 2500;
export const END_OF_SPEECH_MIN_MS = 1000;
export const END_OF_SPEECH_MAX_MS = 5000;
export const END_OF_SPEECH_STEP_MS = 500;

const EOS_KEY = "hb_end_of_speech_ms";

function clampEos(ms: number): number {
  if (!Number.isFinite(ms)) return END_OF_SPEECH_DEFAULT_MS;
  const stepped = Math.round(ms / END_OF_SPEECH_STEP_MS) * END_OF_SPEECH_STEP_MS;
  return Math.min(END_OF_SPEECH_MAX_MS, Math.max(END_OF_SPEECH_MIN_MS, stepped));
}

// The current end-of-speech wait in ms (falls back to the default when unset or
// invalid). Read by both speech providers on each listen.
export function getEndOfSpeechMs(): number {
  try {
    const raw = Number(localStorage.getItem(EOS_KEY));
    return raw > 0 ? clampEos(raw) : END_OF_SPEECH_DEFAULT_MS;
  } catch {
    return END_OF_SPEECH_DEFAULT_MS;  // storage blocked (private mode / enterprise policy)
  }
}

// Persist a new end-of-speech wait (clamped to the safe range). Returns the
// value actually stored, so the UI can reflect the clamped result.
export function setEndOfSpeechMs(ms: number): number {
  const v = clampEos(ms);
  try { localStorage.setItem(EOS_KEY, String(v)); } catch { /* storage blocked — keep in-memory only */ }
  return v;
}

// ── No-speech timeout ────────────────────────────────────────────────
// If we never hear ANY speech, give up after this so the caller can retry or
// surface the "mic isn't picking up" hint. (Browser path only — Azure uses its
// own initial-silence timeout to detect a silent start.)
export const NO_SPEECH_TIMEOUT_MS = 8000;
