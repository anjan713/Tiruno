"use client";

import type { ElementType } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

type NodeStatus = "done" | "active" | "available";

interface SkillNodeProps {
  status: NodeStatus;
  title: string;
  /** How many lessons live in this unit — used for the active-coin a11y label and fallback face. */
  lessonCount?: number;
  /** Share of the unit already completed (0–1) — drawn as the arc on the active ring. */
  progress?: number;
  /** Icon shown on the coin face. */
  icon?: ElementType;
  onClick?: () => void;
  className?: string;
}

/**
 * A single stop on the learning path, rendered as a chunky 3D orange coin. Every
 * coin is orange — state is read from brightness, the check, and (for the current
 * lesson) the ring + START callout, never from a different hue.
 *
 * The "active" state mirrors Duolingo's current-lesson node: the coin sits inside a
 * static progress ring (muted full track + primary arc for the finished share of the
 * unit) while a "START" speech bubble bobs above it forever.
 */
export function SkillNode({
  status,
  title,
  lessonCount = 0,
  progress = 0,
  icon: Icon,
  onClick,
  className,
}: SkillNodeProps) {
  if (status === "active") {
    return (
      <ActiveNode
        title={title}
        lessonCount={lessonCount}
        progress={progress}
        icon={Icon}
        onClick={onClick}
        className={className}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${title} (${status})`}
      className={cn("node mb-1.5 h-[62px] w-[76px]", status === "done" ? "node-done" : "node-available", className)}
    >
      {status === "done" ? (
        <Check className="h-9 w-9 drop-shadow-sm" strokeWidth={3} />
      ) : Icon ? (
        <Icon className="h-8 w-8 drop-shadow-sm" strokeWidth={2.5} />
      ) : null}
    </button>
  );
}

interface ActiveNodeProps {
  title: string;
  lessonCount: number;
  progress: number;
  icon?: ElementType;
  onClick?: () => void;
  className?: string;
}

/** Ring geometry: 104px button, radius 47 + 8px stroke leaves a clear gap around the 72px coin. */
const RING_RADIUS = 47;
const RING_STROKE = 8;

function ActiveNode({ title, lessonCount, progress, icon: Icon, onClick, className }: ActiveNodeProps) {
  const unit = lessonCount === 1 ? "lesson" : "lessons";
  const label = `Current lesson: ${title}, ${lessonCount} ${unit} available.`;
  const arc = Math.max(0, Math.min(1, progress)) * 100;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "skillnode group relative grid h-[104px] w-[104px] place-items-center rounded-full",
        "transition-transform duration-150 will-change-transform hover:scale-105 active:scale-95",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        className
      )}
    >
      {/* Bobbing START callout — speech bubble with a caret, floating above the ring */}
      <span aria-hidden className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 -translate-x-1/2">
        <span className="skillnode-callout">
          Start
          <span className="skillnode-callout-caret" />
        </span>
      </span>

      {/* Progress ring — full muted track, primary arc from 12 o'clock for the done share */}
      <svg aria-hidden viewBox="0 0 104 104" className="skillnode-ring pointer-events-none absolute inset-0 h-full w-full -rotate-90">
        <circle
          cx="52"
          cy="52"
          r={RING_RADIUS}
          fill="none"
          className="skillnode-ring-track"
          strokeWidth={RING_STROKE}
        />
        {arc > 0 && (
          <circle
            cx="52"
            cy="52"
            r={RING_RADIUS}
            fill="none"
            pathLength={100}
            className="skillnode-ring-fill"
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            strokeDasharray={`${arc} 100`}
          />
        )}
      </svg>

      {/* The coin */}
      <span className="skillnode-coin">
        {Icon ? (
          <Icon className="h-9 w-9 drop-shadow-sm" strokeWidth={2.5} />
        ) : (
          <>
            <span className="font-display text-[30px] font-extrabold leading-none">{lessonCount}</span>
            <span className="mt-0.5 text-[9px] font-bold uppercase leading-none tracking-[0.14em] text-white/90">
              {unit}
            </span>
          </>
        )}
      </span>
    </button>
  );
}
