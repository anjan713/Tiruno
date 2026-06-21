"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Map, User, Newspaper, Bookmark, Compass, Moon, Sun, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/cn";
import { useGameStore } from "@/lib/store/useGameStore";
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

  return (
    <nav className="flex h-full w-[88px] shrink-0 flex-col gap-2 border-r border-border bg-surface px-3 py-5 lg:w-[240px]">
      <Link href="/learn" className="mb-4 flex items-center gap-2 px-2" onClick={() => primeAudio()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/mascot/poses/wave.webp" alt="Tiru" className="h-10 w-10 object-contain drag-none" />
        <span className="hidden font-display text-2xl font-extrabold text-primary lg:inline">Tiruno</span>
      </Link>

      <div className="flex flex-1 flex-col gap-1.5">
        {LINKS.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
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
              <Icon className={cn("h-6 w-6 shrink-0 transition-transform group-hover:scale-110", active && "text-primary")} />
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
