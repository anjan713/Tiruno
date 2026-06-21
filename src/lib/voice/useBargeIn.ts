"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VoiceListener, speak, stopSpeaking, transcribe } from "@/lib/voice/voice";
import { askTiru, type AskTiruInput } from "@/lib/ai/ask";

export type BargeStage = "idle" | "listening" | "transcribing" | "thinking" | "answered" | "error";

interface UseBargeInOptions {
  /** When true, Tiru is talking and the user is allowed to interrupt with a question. */
  enabled: boolean;
  /** Output is muted — answers won't be spoken, only shown as text. */
  muted: boolean;
  /** Build the request sent to Tiru from the transcribed question. */
  buildAsk: (question: string) => AskTiruInput;
  /** Called the moment the user starts speaking — stop Tiru's narration here. */
  onInterrupt?: () => void;
  /** Called once the answer finishes (or is dismissed) — resume narration here. */
  onResume?: () => void;
  /** Local fallback answer when the API returns nothing. */
  fallbackAnswer?: (question: string) => string;
}

/**
 * Hands-free "ask Tiru" loop. While `enabled`, keeps the mic open and listens
 * for the user to start talking. On barge-in it interrupts narration, records
 * the question, transcribes it (Deepgram), gets a grounded answer, speaks it
 * back, then resumes. No button required.
 */
export function useBargeIn({
  enabled,
  muted,
  buildAsk,
  onInterrupt,
  onResume,
  fallbackAnswer,
}: UseBargeInOptions) {
  const [stage, setStage] = useState<BargeStage>("idle");
  const [transcript, setTranscript] = useState("");
  const [answer, setAnswer] = useState("");
  const [supported, setSupported] = useState(true);

  const listenerRef = useRef<VoiceListener | null>(null);
  const busyRef = useRef(false); // processing a question / speaking an answer
  const enabledRef = useRef(enabled);

  // Keep latest callbacks/flags without re-creating the listener.
  const cb = useRef({ buildAsk, onInterrupt, onResume, fallbackAnswer, muted });
  cb.current = { buildAsk, onInterrupt, onResume, fallbackAnswer, muted };

  const finish = useCallback(() => {
    busyRef.current = false;
    setStage("idle");
    setTranscript("");
    setAnswer("");
    cb.current.onResume?.();
    if (enabledRef.current) listenerRef.current?.setEnabled(true);
  }, []);

  const process = useCallback(
    async (blob: Blob) => {
      let text = "";
      try {
        if (blob.size) text = await transcribe(blob);
      } catch {
        /* ignore */
      }
      if (!text) {
        finish();
        return;
      }
      setTranscript(text);
      setStage("thinking");
      let ans = "";
      try {
        const r = await askTiru(cb.current.buildAsk(text));
        ans = r.answer;
      } catch {
        /* ignore */
      }
      if (!ans) ans = cb.current.fallbackAnswer?.(text) ?? "Sorry — I didn't catch a clear question. Keep going and ask me anytime.";
      setAnswer(ans);
      setStage("answered");
      if (cb.current.muted) return; // leave the text answer up; user dismisses to resume
      try {
        const audio = await speak(ans);
        audio.onended = () => finish();
      } catch {
        finish();
      }
    },
    [finish]
  );

  // Create the listener once and keep it alive for the component's lifetime.
  useEffect(() => {
    let cancelled = false;
    const listener = new VoiceListener(
      {
        onSpeechStart: () => {
          if (busyRef.current || !enabledRef.current) return;
          busyRef.current = true;
          listenerRef.current?.setEnabled(false);
          setTranscript("");
          setAnswer("");
          setStage("listening");
          cb.current.onInterrupt?.();
        },
        onResult: (blob) => {
          if (!busyRef.current) return;
          setStage("transcribing");
          void process(blob);
        },
        onError: () => setSupported(false),
      },
      { threshold: 0.06, speechMinMs: 180, silenceMs: 800 }
    );
    listenerRef.current = listener;
    listener
      .start()
      .then(() => {
        if (cancelled) return;
        listener.setEnabled(enabledRef.current && !busyRef.current);
      })
      .catch(() => setSupported(false));
    return () => {
      cancelled = true;
      listener.stop();
      listenerRef.current = null;
    };
  }, [process]);

  // Track the enabled flag; only detection toggles, the mic stays open.
  useEffect(() => {
    enabledRef.current = enabled;
    if (!busyRef.current) listenerRef.current?.setEnabled(enabled);
  }, [enabled]);

  /** Force the in-progress question to be sent now (manual "done"). */
  const stopAndAsk = useCallback(() => {
    listenerRef.current?.endUtterance();
  }, []);

  /** Dismiss the current answer and resume immediately. */
  const dismiss = useCallback(() => {
    stopSpeaking();
    finish();
  }, [finish]);

  return {
    stage,
    transcript,
    answer,
    supported,
    active: stage !== "idle",
    stopAndAsk,
    dismiss,
  };
}
