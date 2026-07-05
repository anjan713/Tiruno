"use client";

import Link from "next/link";
import { Lock, Check, Circle, ArrowRight, User, Tag, Link2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Mascot } from "@/components/mascot/Mascot";
import { LEARN_MIN_ARTICLES, LEARN_MIN_KEYWORDS, type LearnGate } from "@/lib/learn/gate";

/** Shown in place of the Learn map until the profile setup gate is satisfied. */
export function LearnLocked({ gate }: { gate: LearnGate }) {
  const items = [
    { icon: User, label: "Add your name", done: gate.hasName },
    {
      icon: Link2,
      label: `Add ${LEARN_MIN_ARTICLES} articles of interest`,
      done: gate.articlesRemaining === 0,
      progress: `${Math.min(gate.articlesAdded, LEARN_MIN_ARTICLES)}/${LEARN_MIN_ARTICLES}`,
    },
    {
      icon: Tag,
      label: `Add ${LEARN_MIN_KEYWORDS} keywords of interest`,
      done: gate.keywordsRemaining === 0,
      progress: `${Math.min(gate.keywordsAdded, LEARN_MIN_KEYWORDS)}/${LEARN_MIN_KEYWORDS}`,
    },
  ];

  return (
    <div className="mx-auto max-w-md py-6 text-center">
      <div className="mb-6 flex flex-col items-center">
        <Mascot state="idle" size={120} float bubble />
        <span className="mt-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Lock className="h-7 w-7" />
        </span>
      </div>

      <h1 className="font-display text-h2 text-text">Learn is locked</h1>
      <p className="mt-2 text-muted">
        Set up your profile first. Add your articles and keywords of interest — then you&apos;ll read the
        articles right here in Learn.
      </p>

      <div className="card mt-6 flex flex-col divide-y divide-border p-2 text-left">
        {items.map(({ icon: Icon, label, done, progress }) => (
          <div key={label} className="flex items-center gap-3 px-3 py-3">
            <span
              className={cn(
                "grid h-9 w-9 shrink-0 place-items-center rounded-xl",
                done ? "bg-success/10 text-success" : "bg-surface-alt text-muted"
              )}
            >
              {done ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
            </span>
            <span className={cn("flex-1 font-semibold", done ? "text-text" : "text-muted")}>{label}</span>
            {progress && !done && <span className="text-xs font-bold text-muted">{progress}</span>}
            {done && <Check className="h-4 w-4 text-success" />}
            {!done && !progress && <Circle className="h-4 w-4 text-muted/40" />}
          </div>
        ))}
      </div>

      <Link href="/profile" className="mt-6 inline-block">
        <Button size="lg">
          Go to your profile <ArrowRight className="h-5 w-5" />
        </Button>
      </Link>
    </div>
  );
}
