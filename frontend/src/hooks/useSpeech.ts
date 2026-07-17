// Unified speech hook. Uses Azure AI Speech when the backend reports it's
// configured (reliable Hindi STT + neural TTS + pronunciation assessment),
// otherwise falls back to the browser Web Speech API.
//
// Both providers expose the same interface; listenOnce resolves a ListenResult
// ({ text, pronunciation }). pronunciation is populated only by Azure.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { ListenResult } from "../types";
import { azureVoiceFor, listenOnceAzure, speakAzure } from "../speech/azure";
import { getEndOfSpeechMs, NO_SPEECH_TIMEOUT_MS } from "../speech/config";

const SpeechRecognitionImpl: any =
  (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

export const browserSpeechSupported = !!(SpeechRecognitionImpl && window.speechSynthesis);

type VoiceCfg = { rate?: number; pitch?: number; prefer?: string } | null;

// ── Browser voice selection ──────────────────────────────────────────
// Browsers (especially Windows/Chrome) expose a small, inconsistent set of
// Hindi voices — sometimes only one. We pick a voice that matches the persona's
// gender when one exists (preferring higher-quality "natural" voices), and
// otherwise shift the pitch so male and female personas still sound clearly
// different even on a single shared voice.
const FEMALE_VOICE_HINTS = ["swara", "kalpana", "heera", "neerja", "aditi", "aarohi", "ananya", "female", "woman"];
const MALE_VOICE_HINTS = ["madhur", "hemant", "ravi", "kabir", "prabhat", "arjun", "male"];

function voiceGender(name: string): "female" | "male" | null {
  const n = name.toLowerCase();
  if (FEMALE_VOICE_HINTS.some((h) => n.includes(h))) return "female"; // check female first ("female" contains "male")
  if (MALE_VOICE_HINTS.some((h) => n.includes(h))) return "male";
  return null;
}

function pickHindiVoice(
  all: SpeechSynthesisVoice[],
  prefer?: string
): { voice: SpeechSynthesisVoice | null; genderMatched: boolean } {
  const hindi = all.filter((v) => v.lang && v.lang.toLowerCase().startsWith("hi"));
  if (!hindi.length) return { voice: all[0] ?? null, genderMatched: false };
  const quality = (v: SpeechSynthesisVoice) => (/natural|neural|online/i.test(v.name) ? 1 : 0);
  const best = (list: SpeechSynthesisVoice[]) => [...list].sort((a, b) => quality(b) - quality(a))[0];
  const matches = prefer ? hindi.filter((v) => voiceGender(v.name) === prefer) : [];
  if (matches.length) return { voice: best(matches), genderMatched: true };
  return { voice: best(hindi), genderMatched: false };
}

export function useSpeech() {
  const recogRef = useRef<any>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [provider, setProvider] = useState<"browser" | "azure">("browser");
  const tokenRef = useRef<{ token: string; region: string; at: number } | null>(null);

  useEffect(() => {
    if (window.speechSynthesis) {
      const load = () => setVoices(window.speechSynthesis.getVoices());
      load();
      window.speechSynthesis.onvoiceschanged = load;
    }
    // Ask the backend which provider to use.
    api
      .speechConfig()
      .then((c) => setProvider(c.enabled ? "azure" : "browser"))
      .catch(() => setProvider("browser"));
  }, []);

  // Cache the Azure token for ~9 minutes (Azure tokens live ~10).
  const azureToken = useCallback(async () => {
    const now = Date.now();
    if (tokenRef.current && now - tokenRef.current.at < 9 * 60 * 1000) {
      return tokenRef.current;
    }
    const { token, region } = await api.speechToken();
    tokenRef.current = { token, region, at: now };
    return tokenRef.current;
  }, []);

  const listenBrowser = useCallback(
    (onInterim?: (t: string) => void) =>
      new Promise<ListenResult>((resolve) => {
        if (!SpeechRecognitionImpl) return resolve({ text: "", pronunciation: null });
        const recog = new SpeechRecognitionImpl();
        recogRef.current = recog;
        recog.lang = "hi-IN";
        recog.interimResults = true;
        // Continuous so a brief pause doesn't end recognition; we decide when the
        // turn is over via the silence timer below.
        recog.continuous = true;
        recog.maxAlternatives = 1;

        let finalText = "";     // everything the browser has finalized so far
        let lastInterim = "";   // words spoken but not yet finalized
        let heardAny = false;
        let settled = false;
        let silenceTimer: ReturnType<typeof setTimeout> | undefined;
        let noSpeechTimer: ReturnType<typeof setTimeout> | undefined;

        // Full utterance = finalized text + the trailing not-yet-final words.
        // Never drops earlier words, so the on-screen transcript can't reset.
        const combined = () => `${finalText} ${lastInterim}`.replace(/\s+/g, " ").trim();

        const settle = () => {
          if (settled) return;
          settled = true;
          if (silenceTimer) clearTimeout(silenceTimer);
          if (noSpeechTimer) clearTimeout(noSpeechTimer);
          try { recog.stop(); } catch { /* ignore */ }
          resolve({ text: combined(), pronunciation: null });
        };

        // (Re)start the end-of-speech countdown. Any speech pushes it back, so
        // we only finish after a real pause — not on every micro-pause.
        const armSilence = () => {
          if (silenceTimer) clearTimeout(silenceTimer);
          // Read fresh each time so a UI change to the wait applies immediately.
          silenceTimer = setTimeout(settle, getEndOfSpeechMs());
        };

        recog.onresult = (e: any) => {
          let interim = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i];
            if (r.isFinal) finalText += r[0].transcript;
            else interim += r[0].transcript;
          }
          lastInterim = interim;
          if (finalText || interim) {
            if (!heardAny) {
              heardAny = true;
              if (noSpeechTimer) clearTimeout(noSpeechTimer);
            }
            onInterim?.(combined());
            armSilence();
          }
        };

        recog.onerror = () => { /* let onend decide whether to retry or finish */ };

        recog.onend = () => {
          if (settled) return;
          if ((recog as any).__manualStop) return settle();
          // The browser can stop on its own mid-turn. If the user has been
          // speaking and hasn't paused long enough yet, keep the session alive
          // so their sentence isn't split; otherwise finish.
          if (heardAny && silenceTimer) {
            try { recog.start(); } catch { settle(); }
          } else {
            settle();
          }
        };

        noSpeechTimer = setTimeout(() => { if (!heardAny) settle(); }, NO_SPEECH_TIMEOUT_MS);
        try {
          recog.start();
        } catch {
          settle();
        }
      }),
    []
  );

  const listenOnce = useCallback(
    async (opts: { onInterim?: (t: string) => void } = {}): Promise<ListenResult> => {
      if (provider === "azure") {
        try {
          const { token, region } = await azureToken();
          return await listenOnceAzure(token, region, opts.onInterim);
        } catch {
          return listenBrowser(opts.onInterim);
        }
      }
      return listenBrowser(opts.onInterim);
    },
    [provider, azureToken, listenBrowser]
  );

  const stopListening = useCallback(() => {
    try {
      const r = recogRef.current;
      if (r) {
        // Mark as an intentional stop so onend won't auto-restart the session.
        r.__manualStop = true;
        r.abort?.();
      }
    } catch {
      /* ignore */
    }
  }, []);

  const speakBrowser = useCallback(
    (text: string, cfg: VoiceCfg) =>
      new Promise<void>((resolve) => {
        const synth = window.speechSynthesis;
        if (!synth) return resolve();
        synth.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "hi-IN";
        // Voices can load asynchronously; read the freshest list available.
        const available = voices.length ? voices : synth.getVoices();
        const { voice, genderMatched } = pickHindiVoice(available, cfg?.prefer);
        if (voice) u.voice = voice;
        u.rate = cfg?.rate ?? 1;
        let pitch = cfg?.pitch ?? 1;
        // No voice actually matched the requested gender (e.g. only one Hindi
        // voice is installed) — nudge pitch GENTLY so male vs female stays
        // distinct without sounding high-pitched/flirty or cartoonishly deep.
        if (!genderMatched && cfg?.prefer === "female") pitch = Math.max(pitch, 1.08);
        if (!genderMatched && cfg?.prefer === "male") pitch = Math.min(pitch, 0.92);
        u.pitch = pitch;
        u.onend = () => resolve();
        u.onerror = () => resolve();
        synth.speak(u);
      }),
    [voices]
  );

  const speak = useCallback(
    async (text: string, cfg: VoiceCfg): Promise<void> => {
      if (provider === "azure") {
        try {
          const { token, region } = await azureToken();
          return await speakAzure(token, region, text, azureVoiceFor(cfg?.prefer));
        } catch {
          return speakBrowser(text, cfg);
        }
      }
      return speakBrowser(text, cfg);
    },
    [provider, azureToken, speakBrowser]
  );

  const cancelSpeech = useCallback(() => {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
  }, []);

  // Azure captures audio itself, so speech is "supported" whenever Azure is on,
  // regardless of browser Web Speech availability.
  const speechSupported = provider === "azure" || browserSpeechSupported;

  return { listenOnce, stopListening, speak, cancelSpeech, speechSupported, provider };
}
