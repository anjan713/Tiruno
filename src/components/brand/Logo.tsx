import { cn } from "@/lib/cn";

const SIZES = {
  sm: { mark: "h-11 w-11", text: "text-xl", gap: "gap-2" },
  md: { mark: "h-16 w-16", text: "text-3xl", gap: "gap-2.5" },
  lg: { mark: "h-28 w-28", text: "text-5xl", gap: "gap-3" },
} as const;

export type LogoSize = keyof typeof SIZES;

interface LogoProps {
  size?: LogoSize;
  showWordmark?: boolean;
  className?: string;
  markClassName?: string;
  wordmarkClassName?: string;
}

/**
 * Tiruno brand logo: the Tiru bear mark + wordmark.
 * Single source of truth for the logo across the app.
 */
export function Logo({
  size = "md",
  showWordmark = true,
  className,
  markClassName,
  wordmarkClassName,
}: LogoProps) {
  const s = SIZES[size];
  return (
    <span className={cn("inline-flex items-center", s.gap, className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/mascot/poses/happy.webp"
        alt="Tiru"
        className={cn(
          "drag-none shrink-0 rounded-xl bg-surface-alt object-contain p-0.5",
          s.mark,
          markClassName
        )}
      />
      {showWordmark && (
        <span
          className={cn(
            "font-display font-extrabold leading-none text-primary",
            s.text,
            wordmarkClassName
          )}
        >
          Tiruno
        </span>
      )}
    </span>
  );
}
