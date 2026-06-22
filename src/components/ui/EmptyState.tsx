"use client";

import { Mascot } from "@/components/mascot/Mascot";
import type { MascotState } from "@/lib/mascot/manifest";
import { cn } from "@/lib/cn";

interface EmptyStateProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  mascot?: MascotState;
  /** Optional CTA / actions rendered below the copy. */
  action?: React.ReactNode;
  className?: string;
}

/** Friendly empty/zero state with Tiru and optional call to action. */
export function EmptyState({ title, description, mascot = "empty", action, className }: EmptyStateProps) {
  return (
    <div className={cn("card flex flex-col items-center gap-3 p-8 text-center animate-fade-in", className)}>
      <Mascot state={mascot} size={96} float />
      <div>
        <p className="font-display text-h3 text-text">{title}</p>
        {description && <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
