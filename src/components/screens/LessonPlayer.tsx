"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { X, Check, BookText, RotateCcw, Volume2, Square } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Hearts } from "@/components/ui/Hearts";
import { Mascot } from "@/components/mascot/Mascot";
import { useGameStore } from "@/lib/store/useGameStore";
import { useMascot } from "@/components/mascot/MascotProvider";
import { playSfx } from "@/lib/sound/sfx";
import { LESSONS, type Lesson } from "@/lib/mock/data";
import type { MascotState } from "@/lib/mascot/manifest";
import { speak, stopSpeaking } from "@/lib/voice/voice";
import { recordEngagement } from "@/lib/notebook";
import { FeedbackPrompt } from "@/components/screens/FeedbackPrompt";

const KEYS = ["1", "2", "3", "4"];

// Placeholder shown while a generated lesson is being fetched.
const LOADING_LESSON: Lesson = {
  id: "loading",
  title: "Loading",
  topic: "",
  concept: "",
  questions: [{ id: "q1", prompt: "", options: ["", "", "", ""], answer: 0, explanation: "", citation: "" }],
};

export function LessonPlayer() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const nodeId = search.get("node") ?? undefined;
  const articleParam = search.get("article") ?? undefined;
  const topicParam = search.get("topic") ?? undefined;
  const indexParam = search.get("index") ?? undefined;
  const countParam = search.get("count") ?? undefined;

  const staticLesson = LESSONS[params.id];
  const [lesson, setLesson] = useState<Lesson>(staticLesson ?? LOADING_LESSON);
  const [loading, setLoading] = useState(!staticLesson);
  const total = lesson.questions.length;

  const hearts = useGameStore((s) => s.hearts);
  const loseHeart = useGameStore((s) => s.loseHeart);
  const addXp = useGameStore((s) => s.addXp);
  const completeNode = useGameStore((s) => s.completeNode);
  const recordTopicProgress = useGameStore((s) => s.recordTopicProgress);
  const refillHearts = useGameStore((s) => s.refillHearts);
  const { fire } = useMascot();
  const muted = useGameStore((s) => s.muted);

  const [qIndex, setQIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [heartsLost, setHeartsLost] = useState(0);
  const [dock, setDock] = useState<MascotState>("idle");
  const [outOfHearts, setOutOfHearts] = useState(false);
  const [phase, setPhase] = useState<"teach" | "quiz" | "feedback">("teach");
  const [narrating, setNarrating] = useState(false);

  const q = lesson.questions[qIndex];
  const isCorrect = checked && selected === q.answer;

  const check = useCallback(() => {
    if (selected === null || checked) return;
    setChecked(true);
    if (selected === q.answer) {
      setCorrectCount((c) => c + 1);
      setDock("correct");
      playSfx("ding");
    } else {
      setHeartsLost((h) => h + 1);
      loseHeart();
      setDock("wrong");
      playSfx("boing");
      if (hearts - 1 <= 0) setOutOfHearts(true);
    }
  }, [selected, checked, q.answer, loseHeart, hearts]);

  const next = useCallback(() => {
    setDock("idle");
    if (qIndex + 1 >= total) {
      const perfect = heartsLost === 0;
      const xp = 20 + correctCount * 4;
      const accuracy = total > 0 ? Math.round((correctCount / total) * 100) : 0;
      addXp(xp);
      if (nodeId) completeNode(nodeId);
      // Quiz performance advances the lesson topic's skill score (mastery + currency).
      recordTopicProgress(lesson.topic, accuracy);
      // If this lesson came from an ingested article, the quiz score extends that
      // article's NotebookLM retention (engaged material survives rotation).
      if (lesson.articleId) void recordEngagement(lesson.articleId, accuracy);
      fire(perfect ? "perfect" : "complete", {
        takeover: true,
        title: perfect ? "Perfect! No hearts lost!" : `Lesson complete! +${xp} XP`,
        gold: perfect,
        duration: 2600,
      });
      // Surface the end-of-lesson feedback step (drives the self-learning loop).
      setTimeout(() => setPhase("feedback"), 1400);
      return;
    }
    setQIndex((i) => i + 1);
    setSelected(null);
    setChecked(false);
  }, [qIndex, total, heartsLost, correctCount, addXp, nodeId, completeNode, recordTopicProgress, lesson.topic, fire, router, lesson.articleId]);

  // Load a generated lesson (id not in the static set) from the API.
  useEffect(() => {
    if (staticLesson) return;
    let cancelled = false;
    (async () => {
      try {
        const qs = new URLSearchParams({ id: params.id });
        if (articleParam) qs.set("article", articleParam);
        if (topicParam) qs.set("topic", topicParam);
        if (indexParam) qs.set("index", indexParam);
        if (countParam) qs.set("count", countParam);
        const res = await fetch(`/api/lesson?${qs.toString()}`);
        const json = await res.json();
        if (!cancelled && json?.lesson?.questions?.length) setLesson(json.lesson as Lesson);
        else if (!cancelled) setLesson(LESSONS["l-activity"]);
      } catch {
        if (!cancelled) setLesson(LESSONS["l-activity"]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id, staticLesson, articleParam, topicParam, indexParam, countParam]);

  // Keyboard play (1-4, Enter)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase !== "quiz" || outOfHearts) return;
      if (KEYS.includes(e.key) && !checked) {
        setSelected(Number(e.key) - 1);
      } else if (e.key === "Enter") {
        if (checked) next();
        else check();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [checked, check, next, outOfHearts, phase]);

  const narrateConcept = useCallback(async () => {
    setNarrating(true);
    setDock("talking");
    try {
      const a = await speak(`${lesson.title}. ${lesson.concept}`);
      a.onended = () => {
        setNarrating(false);
        setDock("idle");
      };
    } catch {
      setNarrating(false);
    }
  }, [lesson.title, lesson.concept]);

  useEffect(() => {
    if (loading || phase !== "teach" || muted) return;
    narrateConcept();
    return () => stopSpeaking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, muted, loading]);

  const startQuiz = () => {
    stopSpeaking();
    setNarrating(false);
    setDock("idle");
    setPhase("quiz");
  };

  const teachDock: MascotState = narrating ? "talking" : "idle";

  const progress = (qIndex + (checked ? 1 : 0)) / total;

  return (
    <div className="relative flex min-h-screen flex-col bg-bg">
      {/* Top bar */}
      <header className="flex items-center gap-4 px-5 py-4 md:px-8">
        <button onClick={() => router.push("/learn")} className="grid h-10 w-10 place-items-center rounded-full text-muted hover:bg-surface-alt hover:text-text" aria-label="Close lesson">
          <X className="h-6 w-6" />
        </button>
        <div className="h-3 flex-1 overflow-hidden rounded-chip bg-surface-alt">
          <div className="h-full rounded-chip bg-success transition-all duration-500" style={{ width: `${progress * 100}%` }} />
        </div>
        <Hearts count={hearts} size={20} />
      </header>

      {loading && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <Mascot state="thinking" size={140} float bubble />
          <p className="font-display text-h3 text-text">Tiru is preparing your lesson…</p>
        </div>
      )}

      {/* Concept teach screen — explain before quizzing */}
      {!loading && phase === "teach" && (
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pt-8 md:px-8 animate-rise">
          <p className="mb-1 font-display text-sm font-bold uppercase tracking-wide text-primary">{lesson.title} · Concept</p>
          <h1 className="mb-6 font-display text-h2 text-text text-balance md:text-display">Here&apos;s the idea</h1>
          <div className="card flex flex-col gap-4 p-6 sm:flex-row">
            <div className="shrink-0 self-center sm:self-start">
              <Mascot state={teachDock} size={120} float />
            </div>
            <div className="flex-1">
              <p className="text-lg leading-relaxed text-text">{lesson.concept}</p>
              <button
                onClick={() => {
                  if (narrating) {
                    stopSpeaking();
                    setNarrating(false);
                  } else {
                    narrateConcept();
                  }
                }}
                className="mt-4 inline-flex items-center gap-2 rounded-chip bg-surface-alt px-3 py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
              >
                {narrating ? <Square className="h-3.5 w-3.5" /> : <Volume2 className="h-4 w-4" />}
                {narrating ? "Stop" : "Play narration"}
              </button>
            </div>
          </div>

          <p className="mt-3 text-sm text-muted">Tiru just explained the concept — ready to try a few questions?</p>
          <div className="mt-6 flex justify-end">
            <Button size="lg" onClick={startQuiz}>
              Got it — start questions
            </Button>
          </div>
        </div>
      )}

      {/* End-of-lesson feedback — drives the self-learning loop */}
      {!loading && phase === "feedback" && (
        <FeedbackPrompt
          lessonTitle={lesson.title}
          topic={lesson.topic || undefined}
          articleId={lesson.articleId}
          scorePct={Math.round((correctCount / total) * 100)}
          struggled={heartsLost > 0 || correctCount / total < 0.8}
          onDone={() => router.push("/learn")}
        />
      )}

      {/* Question */}
      {!loading && phase === "quiz" && (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pt-6 md:px-8">
        <p className="mb-1 font-display text-sm font-bold uppercase tracking-wide text-primary">{lesson.title} · Q{qIndex + 1}</p>
        <h1 className="mb-8 font-display text-h2 text-text text-balance md:text-display">{q.prompt}</h1>

        <div className="grid gap-3 sm:grid-cols-2">
          {q.options.map((opt, i) => {
            const isSel = selected === i;
            const showCorrect = checked && i === q.answer;
            const showWrong = checked && isSel && i !== q.answer;
            return (
              <button
                key={i}
                disabled={checked}
                onClick={() => setSelected(i)}
                className={cn(
                  "flex items-center gap-3 rounded-card border-2 bg-surface p-4 text-left font-semibold transition-all",
                  !checked && isSel && "border-primary -translate-y-0.5 shadow-soft",
                  !checked && !isSel && "border-border hover:border-muted",
                  showCorrect && "border-success bg-success/10 text-text",
                  showWrong && "animate-shake border-danger bg-danger/10",
                  checked && !showCorrect && !showWrong && "opacity-60"
                )}
              >
                <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg border-2 font-display text-sm", isSel ? "border-primary text-primary" : "border-border text-muted")}>
                  {showCorrect ? <Check className="h-4 w-4 text-success" /> : i + 1}
                </span>
                <span>{opt}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-8 hidden justify-end sm:flex">
          {!checked ? (
            <Button size="lg" disabled={selected === null} onClick={check}>Check</Button>
          ) : (
            <Button size="lg" variant={isCorrect ? "success" : "primary"} onClick={next}>Continue</Button>
          )}
        </div>
      </div>
      )}

      {/* Mascot dock — lifts above the feedback sheet when it appears; sits behind it (z-20) so no line crosses it */}
      {phase === "quiz" && (
      <div
        className={cn(
          "pointer-events-none fixed right-6 z-20 hidden transition-all duration-300 md:block",
          checked ? "bottom-[232px]" : "bottom-16"
        )}
      >
        <Mascot state={dock} size={128} />
      </div>
      )}

      {/* Feedback sheet */}
      {checked && (
        <div
          className={cn(
            "sticky bottom-0 z-40 animate-slide-up border-t-2 px-5 py-5 md:px-8",
            isCorrect ? "border-success bg-success/10" : "border-danger bg-danger/10"
          )}
        >
          <div className="mx-auto flex max-w-2xl flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className={cn("font-display text-h3", isCorrect ? "text-success" : "text-danger")}>
                {isCorrect ? "Correct!" : "Not quite"}
              </p>
              <Button size="md" variant={isCorrect ? "success" : "primary"} onClick={next} className="sm:hidden">
                Continue
              </Button>
            </div>
            <p className="text-sm text-text">{q.explanation}</p>
            <span className="chip w-fit bg-surface text-muted">
              <BookText className="h-3.5 w-3.5" /> {q.citation}
            </span>
          </div>
        </div>
      )}

      {/* Out of hearts */}
      {outOfHearts && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6 backdrop-blur-sm">
          <div className="card flex max-w-sm flex-col items-center gap-4 p-8 text-center animate-pop">
            <Mascot state="outOfHearts" size={140} bubble />
            <h3 className="font-display text-h2 text-text">Out of hearts</h3>
            <p className="text-muted">Refill your hearts to keep learning.</p>
            <div className="flex w-full flex-col gap-2">
              <Button
                block
                onClick={() => {
                  refillHearts();
                  playSfx("level_chime");
                  setOutOfHearts(false);
                }}
              >
                <RotateCcw className="h-5 w-5" /> Refill hearts
              </Button>
              <Button block variant="ghost" onClick={() => setOutOfHearts(false)}>Keep practicing</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
