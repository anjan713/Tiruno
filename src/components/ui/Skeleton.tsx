"use client";

import { cn } from "@/lib/cn";

/**
 * Shimmering placeholder block. Compose several to mimic the shape of the
 * content that is loading. Uses the `.skeleton` component class (see globals.css).
 */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn("skeleton", className)} style={style} aria-hidden />;
}

/** Card-shaped skeleton used while lists of cards load. */
export function SkeletonCard({ lines = 2, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("card flex flex-col gap-3 p-5", className)} aria-hidden>
      <div className="flex items-center gap-3">
        <Skeleton className="h-11 w-11 shrink-0 rounded-2xl" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn("h-3", i === lines - 1 ? "w-1/2" : "w-full")} />
      ))}
    </div>
  );
}
