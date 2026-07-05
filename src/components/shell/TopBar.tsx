"use client";

import { useRouter } from "next/navigation";
import { LogOut, Moon, Sun, Volume2, VolumeX } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { useGameStore } from "@/lib/store/useGameStore";
import { PROFILES } from "@/lib/mock/profiles";

export function TopBar() {
  const router = useRouter();
  const name = useGameStore((s) => s.name);
  const persona = useGameStore((s) => s.persona);
  const logout = useGameStore((s) => s.logout);
  const theme = useGameStore((s) => s.theme);
  const muted = useGameStore((s) => s.muted);
  const toggleTheme = useGameStore((s) => s.toggleTheme);
  const toggleMuted = useGameStore((s) => s.toggleMuted);

  const avatar = persona === "professional" ? PROFILES.professional.avatar : PROFILES.student.avatar;

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4">
      <div className="flex items-center gap-2.5">
        {/* Brand mark — only when the left rail is hidden (mobile) */}
        <Logo size="sm" className="md:hidden" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={avatar} alt={name} className="drag-none hidden h-9 w-9 rounded-xl bg-surface-alt object-contain p-0.5 sm:block" />
        <div className="hidden leading-tight sm:block">
          <p className="font-display text-sm font-bold text-text">{name}</p>
          <p className="text-[11px] capitalize text-muted">{persona ?? "learner"}</p>
        </div>
      </div>

      <div className="flex items-center gap-1">
        {/* Theme + sound toggles live in the left rail on desktop; surface them here on mobile */}
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="grid h-9 w-9 place-items-center rounded-btn text-muted transition-colors hover:bg-surface-alt hover:text-text focus-ring md:hidden"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <button
          onClick={toggleMuted}
          aria-label="Toggle sound"
          className="grid h-9 w-9 place-items-center rounded-btn text-muted transition-colors hover:bg-surface-alt hover:text-text focus-ring md:hidden"
        >
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
        <button
          onClick={() => {
            logout();
            router.push("/login");
          }}
          aria-label="Log out"
          className="grid h-9 w-9 place-items-center rounded-btn text-muted transition-colors hover:bg-surface-alt hover:text-text focus-ring"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
