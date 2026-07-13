// Azure AI Speech provider: Hindi STT with unscripted pronunciation
// assessment, and neural TTS. Uses a short-lived auth token minted by the
// backend (the subscription key never reaches the browser).
import * as SDK from "microsoft-cognitiveservices-speech-sdk";
import type { ListenResult } from "../types";

export function azureVoiceFor(prefer: string | undefined): string {
  return prefer === "female" ? "hi-IN-SwaraNeural" : "hi-IN-MadhurNeural";
}

export function listenOnceAzure(
  token: string,
  region: string,
  onInterim?: (t: string) => void
): Promise<ListenResult> {
  return new Promise((resolve) => {
    const speechConfig = SDK.SpeechConfig.fromAuthorizationToken(token, region);
    speechConfig.speechRecognitionLanguage = "hi-IN";
    const audioConfig = SDK.AudioConfig.fromDefaultMicrophoneInput();
    const recognizer = new SDK.SpeechRecognizer(speechConfig, audioConfig);

    // Unscripted (spontaneous speech) pronunciation assessment: empty reference.
    const pa = new SDK.PronunciationAssessmentConfig(
      "",
      SDK.PronunciationAssessmentGradingSystem.HundredMark,
      SDK.PronunciationAssessmentGranularity.Phoneme,
      false
    );
    pa.applyTo(recognizer);

    if (onInterim) {
      recognizer.recognizing = (_s, e) => onInterim(e.result.text);
    }

    recognizer.recognizeOnceAsync(
      (result) => {
        let out: ListenResult = { text: "", pronunciation: null };
        if (result.reason === SDK.ResultReason.RecognizedSpeech && result.text) {
          let pron: number | null = null;
          try {
            pron = SDK.PronunciationAssessmentResult.fromResult(result).pronunciationScore ?? null;
          } catch {
            pron = null;
          }
          out = { text: result.text, pronunciation: pron };
        }
        recognizer.close();
        resolve(out);
      },
      () => {
        recognizer.close();
        resolve({ text: "", pronunciation: null });
      }
    );
  });
}

export function speakAzure(
  token: string,
  region: string,
  text: string,
  voiceName: string
): Promise<void> {
  return new Promise((resolve) => {
    const speechConfig = SDK.SpeechConfig.fromAuthorizationToken(token, region);
    speechConfig.speechSynthesisVoiceName = voiceName;
    const synth = new SDK.SpeechSynthesizer(speechConfig);
    synth.speakTextAsync(
      text,
      () => {
        synth.close();
        resolve();
      },
      () => {
        synth.close();
        resolve();
      }
    );
  });
}
