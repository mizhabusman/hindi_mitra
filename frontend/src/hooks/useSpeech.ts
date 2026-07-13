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

const SpeechRecognitionImpl: any =
  (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

export const browserSpeechSupported = !!(SpeechRecognitionImpl && window.speechSynthesis);

// How long the speaker may pause before we treat the utterance as finished.
// Deliberately longer than the browser's eager default so natural mid-sentence
// pauses don't cut the user off (closer to ChatGPT Voice Mode).
const END_OF_SPEECH_MS = 1500;
// If we never hear any speech, give up after this so the caller can retry or
// surface the "mic isn't picking up" hint.
const NO_SPEECH_TIMEOUT_MS = 8000;

type VoiceCfg = { rate?: number; pitch?: number; prefer?: string } | null;

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
          silenceTimer = setTimeout(settle, END_OF_SPEECH_MS);
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
        const hindi = voices.filter((v) => v.lang && v.lang.startsWith("hi"));
        const prefer = cfg?.prefer;
        const femaleHints = ["female", "swara", "kalpana", "heera", "woman", "neerja", "aditi"];
        const maleHints = ["male", "hemant", "madhur", "man", "ravi", "kabir"];
        const hints = prefer === "female" ? femaleHints : prefer === "male" ? maleHints : [];
        const match = hindi.find((v) => hints.some((h) => v.name.toLowerCase().includes(h)));
        const chosen = match || hindi[0];
        if (chosen) u.voice = chosen;
        u.rate = cfg?.rate ?? 1;
        u.pitch = cfg?.pitch ?? 1;
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
