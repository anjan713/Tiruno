"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Map, Newspaper, Bookmark, Compass, User, Lock } from "lucide-react";
import { cn } from "@/lib/cn";
import { useGameStore } from "@/lib/store/useGameStore";
import { learnGate } from "@/lib/learn/gate";
import { primeAudio } from "@/lib/sound/sfx";

const LINKS = [
  { href: "/learn", label: "Learn", icon: Map },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/feed", label: "Feed", icon: Newspaper },
  { href: "/articles", label: "Articles", icon: Bookmark },
  { href: "/profile", label: "You", icon: User },
];

/** Mobile-only bottom tab bar. Hidden on md+ where the left rail takes over. */
export function BottomNav() {
  const pathname = usePathname();
  const name = useGameStore((s) => s.name);
  const interestArticleIds = useGameStore((s) => s.interestArticleIds);
  const interestKeywords = useGameStore((s) => s.interestKeywords);
  const learnLocked = !learnGate({ name, interestArticleIds, interestKeywords }).unlocked;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex h-safe-nav items-stretch border-t border-border bg-surface/95 pb-safe backdrop-blur supports-[backdrop-filter]:bg-surface/80 md:hidden">
      {LINKS.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href);
        const locked = href === "/learn" && learnLocked;
        return (
          <Link
            key={href}
            href={href}
            onClick={() => primeAudio()}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex flex-1 flex-col items-center justify-center gap-1 pt-1 text-[10px] font-bold transition-colors focus-ring",
              active ? "text-primary" : "text-muted"
            )}
          >
            <span
              className={cn(
                "relative grid h-8 w-12 place-items-center rounded-chip transition-all",
                active ? "bg-primary/10" : "group-active:bg-surface-alt"
              )}
            >
              <Icon className={cn("h-5 w-5 transition-transform", active && "scale-110")} />
              {locked && (
                <Lock className="absolute right-1 top-0 h-3 w-3 rounded-full bg-surface p-0.5 text-muted" />
              )}
            </span>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
