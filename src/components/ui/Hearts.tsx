"use client";

import { Heart } from "lucide-react";
import { cn } from "@/lib/cn";

export function Hearts({ count, max = 5, size = 20, className }: { count: number; max?: number; size?: number; className?: string }) {
  return (
    <div className={cn("flex items-center gap-1", className)} aria-label={`${count} of ${max} hearts`}>
      {Array.from({ length: max }).map((_, i) => {
        const filled = i < count;
        return (
          <Heart
            key={i}
            size={size}
            className={cn(
              "transition-all duration-300",
              filled ? "fill-danger text-danger" : "fill-transparent text-border"
            )}
            style={filled ? { filter: "drop-shadow(0 1px 0 rgba(0,0,0,.08))" } : undefined}
          />
        );
      })}
    </div>
  );
}
