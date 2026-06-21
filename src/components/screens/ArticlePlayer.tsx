"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { X, Mic, Play, Pause, RotateCcw, Check, BookText, ArrowRight, Loader2, Square } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Hearts } from "@/components/ui/Hearts";
import { Mascot } from "@/components/mascot/Mascot";
import { useGameStore } from "@/lib/store/useGameStore";
import { useMascot } from "@/components/mascot/MascotProvider";
import { playSfx } from "@/lib/sound/sfx";
import { ARTICLES } from "@/lib/mock/data";
import type { MascotState } from "@/lib/mascot/manifest";
import { speak, stopSpeaking } from "@/lib/voice/voice";
import { useBargeIn } from "@/lib/voice/useBargeIn";

type Phase = "narrating" | "done" | "checkpoint" | "qa";

function answerFor(t: string) {
  const q = t.toLowerCase();
  if (q.includes("vector") || q.includes("embedding"))
    return "Vectors capture meaning, so we retrieve text that's relevant even when the wording differs — that's why semantic search beats keyword matching here.";
  if (q.includes("hallucinat") || q.includes("trust") || q.includes("wrong"))
    return "Grounding the model in retrieved sources keeps it honest — it answers from real material and cites it instead of guessing.";
  return "Great question! Retrieval keeps the answer grounded in your sources, so Tiru teaches from real material and cites it — not guesses.";
}

export function ArticlePlayer() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const nodeId = search.get("node") ?? undefined;

  const article = ARTICLES[params.id] ?? ARTICLES["a-llm-rag"];
  const segments = article.segments;

  const hearts = useGameStore((s) => s.hearts);
  const loseHeart = useGameStore((s) => s.loseHeart);
  const addXp = useGameStore((s) => s.addXp);
  const completeNode = useGameStore((s) => s.completeNode);
  const keepStreak = useGameStore((s) => s.keepStreak);
  const { fire } = useMascot();

  const muted = useGameStore((s) => s.muted);
  const [segIndex, setSegIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("narrating");
  const [narrProgress, setNarrProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [dock, setDock] = useState<MascotState>("talking");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const raf = useRef<number>(0);
  const runId = useRef(0);

  const seg = segments[segIndex];
  const narrationText = `${seg.heading}. ${seg.text}`;

  const startNarration = useCallback(async () => {
    const id = ++runId.current;
    cancelAnimationFrame(raf.current);
    stopSpeaking();
    setPaused(false);
    setNarrProgress(0);
    setPhase("narrating");
    setDock("talking");
    const finish = () => {
      if (id !== runId.current) return;
      setNarrProgress(1);
      setDock("idle");
      setPhase(seg.checkpoint ? "checkpoint" : "done");
    };
    const fallback = () => {
      const start = performance.now();
      const dur = 2600;
      const tick = (t: number) => {
        if (id !== runId.current) return;
        const p = Math.min(1, (t - start) / dur);
        setNarrProgress(p);
        if (p >= 1) return finish();
        raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    };
    if (muted) return fallback();
    try {
      const audio = await speak(narrationText);
      if (id !== runId.current) {
        audio.pause();
        return;
      }
      audioRef.current = audio;
      audio.ontimeupdate = () => {
        if (id === runId.current && audio.duration) setNarrProgress(Math.min(1, audio.currentTime / audio.duration));
      };
      audio.onended = finish;
    } catch {
      fallback();
    }
  }, [narrationText, muted, seg.checkpoint]);

  // (Re)start narration whenever the segment changes
  useEffect(() => {
    setSelected(null);
    setChecked(false);
    startNarration();
    return () => {
      runId.current++;
      cancelAnimationFrame(raf.current);
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segIndex]);

  const togglePause = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      a.play();
      setPaused(false);
      setDock("talking");
    } else {
      a.pause();
      setPaused(true);
      setDock("idle");
    }
  };

  const replay = () => startNarration();

  const advance = useCallback(() => {
    runId.current++;
    stopSpeaking();
    cancelAnimationFrame(raf.current);
    if (segIndex + 1 >= segments.length) {
      const xp = 15 + segments.length * 3;
      addXp(xp);
      keepStreak();
      if (nodeId) completeNode(nodeId);
      fire("complete", { takeover: true, title: `Article complete! +${xp} XP`, duration: 2600 });
      setTimeout(() => router.push("/learn"), 1400);
      return;
    }
    setSegIndex((i) => i + 1);
  }, [segIndex, segments.length, addXp, keepStreak, nodeId, completeNode, fire, router]);

  const checkCheckpoint = () => {
    if (selected === null) return;
    setChecked(true);
    const cp = seg.checkpoint!;
    if (selected === cp.answer) {
      setDock("correct");
      playSfx("ding");
    } else {
      setDock("wrong");
      playSfx("boing");
      loseHeart();
    }
  };

  // Hands-free barge-in: while Tiru narrates, the mic stays open. The moment the
  // user starts talking, narration stops and the question is captured, answered,
  // and spoken back — no button required.
  const context = segments.map((s) => `${s.heading}. ${s.text}`).join("\n\n");
  const {
    stage: qaStage,
    transcript,
    answer,
    supported: micSupported,
    stopAndAsk,
    dismiss,
  } = useBargeIn({
    enabled: phase === "narrating" || phase === "done",
    muted,
    buildAsk: (question) => ({ question, articleId: params.id, context, title: article.title }),
    fallbackAnswer: answerFor,
    onInterrupt: () => {
      audioRef.current?.pause();
      stopSpeaking();
      runId.current++; // cancel narration callbacks
      cancelAnimationFrame(raf.current);
      setPaused(true);
      setPhase("qa");
      setDock("listening");
      playSfx("level_chime");
    },
    onResume: () => {
      if (narrProgress >= 1) {
        setPhase(seg.checkpoint ? "checkpoint" : "done");
        setDock("idle");
      } else {
        startNarration();
      }
    },
  });

  const qaDock: MascotState =
    qaStage === "listening" ? "listening" : qaStage === "answered" ? "talking" : "thinking";

  const overall = (segIndex + narrProgress) / segments.length;
  const cp = seg.checkpoint;
  const cpCorrect = checked && cp && selected === cp.answer;

  return (
    <div className="relative flex min-h-screen flex-col bg-bg">
      <header className="flex items-center gap-4 px-5 py-4 md:px-8">
        <button onClick={() => router.push("/learn")} className="grid h-10 w-10 place-items-center rounded-full text-muted hover:bg-surface-alt hover:text-text" aria-label="Close">
          <X className="h-6 w-6" />
        </button>
        <div className="h-3 flex-1 overflow-hidden rounded-chip bg-surface-alt">
          <div className="h-full rounded-chip bg-secondary transition-all duration-300" style={{ width: `${overall * 100}%` }} />
        </div>
        <span className="text-sm font-semibold text-muted">{segIndex + 1}/{segments.length}</span>
        <Hearts count={hearts} size={18} />
      </header>

      <div className="mx-auto grid w-full max-w-3xl flex-1 grid-cols-1 gap-6 px-5 pt-6 md:grid-cols-[1fr_auto] md:px-8">
        {/* Article body */}
        <div>
          <p className="mb-1 font-display text-sm font-bold uppercase tracking-wide text-secondary">{article.source}</p>
          <h1 className="mb-2 font-display text-h2 text-text">{article.title}</h1>
          <div className="card p-6">
            <h2 className="mb-3 font-display text-h3 text-text">{seg.heading}</h2>
            <p className={cn("text-lg leading-relaxed text-text transition-opacity", phase === "qa" && "opacity-40")}>{seg.text}</p>
            {/* narration caption progress */}
            <div className="mt-4 h-1.5 overflow-hidden rounded-chip bg-surface-alt">
              <div className="h-full rounded-chip bg-secondary" style={{ width: `${narrProgress * 100}%` }} />
            </div>
          </div>

          {/* Controls */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="neutral" onClick={replay}>
              <RotateCcw className="h-4 w-4" /> Replay
            </Button>
            <Button size="sm" variant="neutral" onClick={togglePause} disabled={phase !== "narrating" || !audioRef.current}>
              {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />} {paused ? "Resume" : "Pause"}
            </Button>
            <span className="chip bg-surface-alt text-muted">
              <Mic className={cn("h-3.5 w-3.5", micSupported ? "text-secondary" : "text-muted")} />
              {micSupported ? "Just speak to ask Tiru — anytime" : "Enable your mic to ask Tiru"}
            </span>
          </div>

          {/* Q&A panel — hands-free barge-in (VAD -> Deepgram STT -> grounded answer -> TTS) */}
          {phase === "qa" && (
            <div className="mt-4 card animate-rise border-2 border-secondary/40 p-5">
              <div className="mb-3 flex items-center gap-2 text-secondary">
                <Mic className={cn("h-4 w-4", qaStage === "listening" && "animate-pulse text-danger")} />
                <span className="font-display text-sm font-bold">
                  {qaStage === "listening"
                    ? "Listening… just speak your question"
                    : qaStage === "transcribing"
                    ? "Transcribing…"
                    : qaStage === "thinking"
                    ? "Tiru is thinking…"
                    : qaStage === "answered"
                    ? "Tiru says"
                    : "Ask Tiru"}
                </span>
              </div>
              {transcript && <p className="mb-2 italic text-muted">“{transcript}”</p>}
              {answer && <p className="text-text">{answer}</p>}
              <div className="mt-4 flex justify-end gap-2">
                {qaStage === "listening" ? (
                  <Button size="sm" onClick={stopAndAsk}>
                    <Square className="h-4 w-4" /> Stop &amp; ask
                  </Button>
                ) : qaStage === "transcribing" || qaStage === "thinking" ? (
                  <Button size="sm" variant="neutral" disabled>
                    <Loader2 className="h-4 w-4 animate-spin" /> Working…
                  </Button>
                ) : (
                  <Button size="sm" variant="success" onClick={dismiss}>
                    <ArrowRight className="h-4 w-4" /> Resume narration
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Checkpoint */}
          {phase === "checkpoint" && cp && (
            <div className="mt-5 card animate-rise p-5">
              <p className="mb-1 font-display text-sm font-bold uppercase tracking-wide text-primary">Checkpoint · answer to continue</p>
              <h3 className="mb-4 font-display text-h3 text-text">{cp.prompt}</h3>
              <div className="grid gap-2.5">
                {cp.options.map((opt, i) => {
                  const isSel = selected === i;
                  const showCorrect = checked && i === cp.answer;
                  const showWrong = checked && isSel && i !== cp.answer;
                  return (
                    <button
                      key={i}
                      disabled={checked && cpCorrect}
                      onClick={() => { if (!cpCorrect) { setSelected(i); setChecked(false); } }}
                      className={cn(
                        "flex items-center gap-3 rounded-btn border-2 bg-surface p-3 text-left font-semibold transition-all",
                        !checked && isSel && "border-primary",
                        !checked && !isSel && "border-border hover:border-muted",
                        showCorrect && "border-success bg-success/10",
                        showWrong && "animate-shake border-danger bg-danger/10"
                      )}
                    >
                      <span className="grid h-7 w-7 place-items-center rounded-lg border-2 border-border font-display text-xs text-muted">
                        {showCorrect ? <Check className="h-4 w-4 text-success" /> : i + 1}
                      </span>
                      {opt}
                    </button>
                  );
                })}
              </div>
              {checked && (
                <div className={cn("mt-3 rounded-btn p-3 text-sm", cpCorrect ? "bg-success/10 text-text" : "bg-danger/10 text-text")}>
                  <p>{cp.explanation}</p>
                  <span className="chip mt-2 bg-surface text-muted"><BookText className="h-3.5 w-3.5" /> {cp.citation}</span>
                </div>
              )}
              <div className="mt-4 flex justify-end">
                {!cpCorrect ? (
                  <Button onClick={checkCheckpoint} disabled={selected === null}>Check</Button>
                ) : (
                  <Button variant="success" onClick={advance}>Continue <ArrowRight className="h-4 w-4" /></Button>
                )}
              </div>
            </div>
          )}

          {/* Continue when no checkpoint */}
          {phase === "done" && (
            <div className="mt-5 flex justify-end">
              <Button size="lg" onClick={advance}>Continue <ArrowRight className="h-5 w-5" /></Button>
            </div>
          )}
        </div>

        {/* Narrating mascot */}
        <div className="hidden md:block">
          <div className="sticky top-8 flex flex-col items-center">
            <Mascot state={phase === "qa" ? qaDock : phase === "narrating" && !paused ? "talking" : dock} size={180} float bubble />
          </div>
        </div>
      </div>
      <div className="h-10" />
    </div>
  );
}
