"use client";

import { cn } from "@/lib/cn";

interface ProgressRingProps {
  value: number; // 0..1
  size?: number;
  stroke?: number;
  className?: string;
  children?: React.ReactNode;
  color?: string;
}

export function ProgressRing({
  value,
  size = 84,
  stroke = 9,
  className,
  children,
  color = "rgb(var(--primary))",
}: ProgressRingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div className={cn("relative inline-grid place-items-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--border))" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped)}
          style={{ transition: "stroke-dashoffset 700ms cubic-bezier(.34,1.56,.64,1)" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}
