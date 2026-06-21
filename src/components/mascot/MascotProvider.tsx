"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Mascot } from "./Mascot";
import { MASCOT, type MascotState } from "@/lib/mascot/manifest";
import { playSfx } from "@/lib/sound/sfx";
import { burstConfetti } from "@/lib/fx/confetti";

interface FireOpts {
  takeover?: boolean;
  gold?: boolean;
  duration?: number;
  title?: string;
}

interface MascotApi {
  ambient: MascotState;
  setAmbient: (s: MascotState) => void;
  fire: (s: MascotState, opts?: FireOpts) => void;
}

const Ctx = createContext<MascotApi | null>(null);

export function useMascot() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useMascot must be used within MascotProvider");
  return ctx;
}

export function MascotProvider({ children }: { children: React.ReactNode }) {
  const [ambient, setAmbient] = useState<MascotState>("idle");
  const [takeover, setTakeover] = useState<{ state: MascotState; title?: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fire = useCallback((s: MascotState, opts: FireOpts = {}) => {
    const def = MASCOT[s];
    playSfx(def.sfx);
    if (def.fx === "confetti" || s === "complete" || s === "perfect") {
      burstConfetti({ gold: opts.gold || s === "perfect" });
    }
    if (opts.takeover) {
      if (timer.current) clearTimeout(timer.current);
      setTakeover({ state: s, title: opts.title ?? def.line });
      timer.current = setTimeout(() => setTakeover(null), opts.duration ?? 2800);
    }
  }, []);

  return (
    <Ctx.Provider value={{ ambient, setAmbient, fire }}>
      {children}
      {takeover && (
        <div
          className="fixed inset-0 z-[60] grid place-items-center bg-black/45 backdrop-blur-sm animate-[rise_0.3s_ease-out]"
          onClick={() => setTakeover(null)}
          role="dialog"
          aria-live="assertive"
        >
          <div className="flex flex-col items-center gap-4">
            <Mascot state={takeover.state} size={240} float />
            {takeover.title && (
              <div className="rounded-card bg-surface border border-border px-8 py-4 shadow-lift animate-pop">
                <p className="font-display text-h2 text-text">{takeover.title}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
