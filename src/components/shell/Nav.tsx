"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Map, User, Newspaper, Bookmark, Compass, Moon, Sun, Volume2, VolumeX, Lock } from "lucide-react";
import { cn } from "@/lib/cn";
import { Logo } from "@/components/brand/Logo";
import { useGameStore } from "@/lib/store/useGameStore";
import { learnGate } from "@/lib/learn/gate";
import { primeAudio } from "@/lib/sound/sfx";

const LINKS = [
  { href: "/learn", label: "Learn", icon: Map },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/feed", label: "Feed", icon: Newspaper },
  { href: "/articles", label: "My Articles", icon: Bookmark },
  { href: "/profile", label: "Profile", icon: User },
];

export function Nav() {
  const pathname = usePathname();
  const theme = useGameStore((s) => s.theme);
  const muted = useGameStore((s) => s.muted);
  const toggleTheme = useGameStore((s) => s.toggleTheme);
  const toggleMuted = useGameStore((s) => s.toggleMuted);
  const name = useGameStore((s) => s.name);
  const interestArticleIds = useGameStore((s) => s.interestArticleIds);
  const interestKeywords = useGameStore((s) => s.interestKeywords);
  const learnLocked = !learnGate({ name, interestArticleIds, interestKeywords }).unlocked;

  return (
    <nav className="hidden h-full w-[88px] shrink-0 flex-col gap-2 border-r border-border bg-surface px-3 py-5 md:flex lg:w-[240px]">
      <Link href="/learn" className="mb-4 flex items-center px-2" onClick={() => primeAudio()}>
        <Logo wordmarkClassName="hidden lg:inline" />
      </Link>

      <div className="flex flex-1 flex-col gap-1.5">
        {LINKS.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          const locked = href === "/learn" && learnLocked;
          return (
            <Link
              key={href}
              href={href}
              onClick={() => primeAudio()}
              className={cn(
                "group flex items-center gap-3 rounded-btn px-3 py-3 font-display font-bold transition-colors",
                active ? "bg-primary/10 text-primary" : "text-muted hover:bg-surface-alt hover:text-text"
              )}
            >
              <span className="relative shrink-0">
                <Icon className={cn("h-6 w-6 transition-transform group-hover:scale-110", active && "text-primary")} />
                {locked && (
                  <Lock className="absolute -right-1.5 -top-1.5 h-3.5 w-3.5 rounded-full bg-surface p-0.5 text-muted" />
                )}
              </span>
              <span className="hidden lg:inline">{label}</span>
            </Link>
          );
        })}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border pt-3">
        <button
          onClick={toggleTheme}
          className="flex items-center gap-3 rounded-btn px-3 py-2.5 text-muted hover:bg-surface-alt hover:text-text"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          <span className="hidden text-sm font-semibold lg:inline">{theme === "dark" ? "Light" : "Dark"} mode</span>
        </button>
        <button
          onClick={toggleMuted}
          className="flex items-center gap-3 rounded-btn px-3 py-2.5 text-muted hover:bg-surface-alt hover:text-text"
          aria-label="Toggle sound"
        >
          {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          <span className="hidden text-sm font-semibold lg:inline">{muted ? "Unmute" : "Sound on"}</span>
        </button>
      </div>
    </nav>
  );
}
