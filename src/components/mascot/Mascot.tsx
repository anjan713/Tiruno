"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";
import { useCursorLean } from "@/lib/hooks/useCursorLean";
import {
  MASCOT,
  clipWebm,
  clipWebp,
  clipPoster,
  poseWebp,
  type MascotState,
} from "@/lib/mascot/manifest";

interface MascotProps {
  state?: MascotState;
  size?: number;
  className?: string;
  bubble?: boolean;
  lean?: boolean;
  float?: boolean;
}

export function Mascot({ state = "idle", size = 120, className, bubble, lean, float }: MascotProps) {
  const def = MASCOT[state];
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState(false);
  const leanRef = useCursorLean<HTMLDivElement>(lean ? 10 : 0);

  useEffect(() => setFailed(false), [state]);

  const clip = def.clip;
  const showVideo = !!clip && !reduced && !failed;

  return (
    <div className={cn("relative inline-flex flex-col items-center", className)}>
      {bubble && def.line && (
        <div className="mb-2 max-w-[220px] rounded-2xl rounded-bl-sm bg-surface border border-border px-3 py-2 text-sm font-semibold text-text shadow-soft animate-pop">
          {def.line}
        </div>
      )}
      <div
        ref={lean ? leanRef : undefined}
        className={cn("relative will-change-transform transition-transform", float && "animate-bob")}
        style={{ width: size, height: size }}
      >
        {showVideo ? (
          <video
            key={clip}
            width={size}
            height={size}
            autoPlay
            loop
            muted
            playsInline
            poster={clipPoster(clip!)}
            onError={() => setFailed(true)}
            className="h-full w-full object-contain drag-none"
          >
            <source src={clipWebm(clip!)} type="video/webm" />
          </video>
        ) : clip && !reduced ? (
          // Safari / VP9-alpha fallback: animated WebP
          // eslint-disable-next-line @next/next/no-img-element
          <img src={clipWebp(clip)} alt="Tiru" width={size} height={size} className="h-full w-full object-contain drag-none" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={poseWebp(def.pose)} alt="Tiru" width={size} height={size} className="h-full w-full object-contain drag-none" />
        )}
      </div>
    </div>
  );
}
