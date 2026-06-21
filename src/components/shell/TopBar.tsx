"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { useGameStore } from "@/lib/store/useGameStore";
import { PROFILES } from "@/lib/mock/profiles";

export function TopBar() {
  const router = useRouter();
  const name = useGameStore((s) => s.name);
  const persona = useGameStore((s) => s.persona);
  const logout = useGameStore((s) => s.logout);

  const avatar = persona === "professional" ? PROFILES.professional.avatar : PROFILES.student.avatar;

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4">
      <div className="flex items-center gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={avatar} alt={name} className="drag-none h-9 w-9 rounded-xl bg-surface-alt object-contain p-0.5" />
        <div className="leading-tight">
          <p className="font-display text-sm font-bold text-text">{name}</p>
          <p className="text-[11px] capitalize text-muted">{persona ?? "learner"}</p>
        </div>
      </div>

      <button
        onClick={() => {
          logout();
          router.push("/login");
        }}
        aria-label="Log out"
        className="grid h-9 w-9 place-items-center rounded-btn text-muted transition-colors hover:bg-surface-alt hover:text-text"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </header>
  );
}
