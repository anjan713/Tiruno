"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, ArrowRight, Loader2, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Mascot } from "@/components/mascot/Mascot";

interface Gap {
  blocker: string;
  blockerLabel: string;
  topic: string;
  topicLabel: string;
  suggestion: string;
}

/**
 * End-of-lesson feedback. The highest-signal step: if the learner struggled we
 * ask *why* (free text). When a missing prerequisite is detected, we offer to
 * learn it first (self-learning loop). See design/userflow.md §5-6.
 */
export function FeedbackPrompt({
  lessonTitle,
  topic,
  articleId,
  scorePct,
  struggled,
  onDone,
}: {
  lessonTitle: string;
  topic?: string;
  articleId?: string;
  scorePct: number;
  struggled: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [stage, setStage] = useState<"ask" | "submitting" | "gap">("ask");
  const [gap, setGap] = useState<Gap | null>(null);

  const submit = async () => {
    setStage("submitting");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articleId, topic, lessonTitle, scorePct, feedbackText: text.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.gap) {
        setGap(data.gap as Gap);
        setStage("gap");
      } else {
        onDone();
      }
    } catch {
      onDone();
    }
  };

  const acceptPrereq = async () => {
    if (!gap) return;
    setStage("submitting");
    try {
      await fetch("/api/prereq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blocker: gap.blocker,
          blockerLabel: gap.blockerLabel,
          topicLabel: gap.topicLabel,
          suggestion: gap.suggestion,
        }),
      });
    } catch {
      /* best effort */
    }
    router.push("/learn");
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pt-8 md:px-8 animate-rise">
      <div className="card flex flex-col gap-4 p-6">
        <div className="flex items-center gap-4">
          <Mascot state={struggled ? "thinking" : "complete"} size={92} float />
          <div>
            <p className="font-display text-sm font-bold uppercase tracking-wide text-primary">
              {lessonTitle} · Feedback
            </p>
            <h1 className="font-display text-h2 text-text">
              {scorePct >= 80 ? "Nicely done!" : "Thanks for sticking with it"}
            </h1>
            <p className="text-sm text-muted">You scored {scorePct}% on this lesson.</p>
          </div>
        </div>

        {stage === "gap" && gap ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-card border-2 border-amber/40 bg-amber/10 p-4">
              <p className="mb-1 flex items-center gap-2 font-display font-bold text-amber">
                <Sparkles className="h-4 w-4" /> Tiru spotted something
              </p>
              <p className="text-text">{gap.suggestion}</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={() => router.push("/learn")}>
                No, continue {gap.topicLabel}
              </Button>
              <Button onClick={acceptPrereq}>
                Yes, learn {gap.blockerLabel} first <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <label htmlFor="fb" className="font-semibold text-text">
              {struggled
                ? "Why weren't you able to answer some of these? (this helps Tiru help you)"
                : "Anything confusing, or topics you'd like to go deeper on?"}
            </label>
            <textarea
              id="fb"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder={struggled ? "e.g. I don't know Docker" : "Optional — leave blank to skip"}
              className="w-full rounded-btn border-2 border-border bg-surface px-4 py-3 text-text outline-none transition-colors focus:border-primary"
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={onDone} disabled={stage === "submitting"}>
                Skip
              </Button>
              <Button onClick={submit} disabled={stage === "submitting"}>
                {stage === "submitting" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Sending…
                  </>
                ) : (
                  <>
                    <ThumbsUp className="h-4 w-4" /> Share feedback
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
