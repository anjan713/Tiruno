"use client";

import { Mascot } from "@/components/mascot/Mascot";
import type { MascotState } from "@/lib/mascot/manifest";
import { cn } from "@/lib/cn";

interface PageHeaderProps {
  /** Small uppercase label above the title. */
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Accent colour for the eyebrow text. */
  accent?: "primary" | "secondary";
  /** Optional leading icon shown beside the title. */
  icon?: React.ReactNode;
  /** Right-aligned actions (buttons, etc.). */
  actions?: React.ReactNode;
  /** Show the floating Tiru mascot on the right. */
  mascot?: MascotState | false;
  className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  accent = "primary",
  icon,
  actions,
  mascot = false,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("mb-6 flex items-start justify-between gap-4 animate-fade-in", className)}>
      <div className="min-w-0">
        {eyebrow && (
          <p className={cn("font-display text-sm font-bold uppercase tracking-wide", accent === "secondary" ? "text-secondary" : "text-primary")}>
            {eyebrow}
          </p>
        )}
        <h1 className="flex items-center gap-2 font-display text-display text-text text-balance">
          {icon}
          {title}
        </h1>
        {subtitle && <p className="mt-0.5 text-muted text-balance">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      {mascot && <Mascot state={mascot} size={84} float lean className="hidden shrink-0 sm:flex" />}
    </header>
  );
}
