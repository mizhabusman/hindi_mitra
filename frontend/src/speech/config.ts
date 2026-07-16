// Shared speech-capture tuning — the single place to fine-tune how the app
// decides a spoken turn is finished, so behaviour is identical across both
// speech providers (browser Web Speech + Azure Speech).

// How long the speaker may pause before we treat the utterance as finished.
// This is a Hindi SPEAKING ASSESSMENT: users naturally pause to think mid-answer,
// so we wait a generous, patient beat rather than cutting them off. Raise this
// if users report being interrupted; lower it if turns feel sluggish to submit.
// Applies to BOTH providers (browser silence timer + Azure segmentation timeout).
export const END_OF_SPEECH_MS = 2500;

// If we never hear ANY speech, give up after this so the caller can retry or
// surface the "mic isn't picking up" hint. (Browser path only — Azure uses its
// own initial-silence timeout to detect a silent start.)
export const NO_SPEECH_TIMEOUT_MS = 8000;
