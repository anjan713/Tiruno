"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Flame, Zap, Newspaper, CheckCircle2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Hearts } from "@/components/ui/Hearts";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { useGameStore, xpForLevel } from "@/lib/store/useGameStore";
import { useMascot } from "@/components/mascot/MascotProvider";
import { IntegrationsPanel } from "@/components/notebook/IntegrationsPanel";
import { ProfileSetup } from "@/components/profile/ProfileSetup";
import { skillScore } from "@/lib/learn/skill";

const BADGES = [
  { id: "first", img: "/art/badges/badge_first.webp", label: "First Lesson" },
  { id: "streak", img: "/art/badges/badge_streak.webp", label: "7-Day Streak" },
  { id: "levelup", img: "/art/badges/badge_levelup.webp", label: "Level 3" },
  { id: "perfect", img: "/art/badges/badge_perfect.webp", label: "Flawless" },
];

export default function ProfilePage() {
  const router = useRouter();
  const { xp, level, streak, hearts, maxHearts, completedNodes, persona, name, topicScores, articlesReadIds, resetOnboarding } = useGameStore();
  const { setAmbient } = useMascot();

  useEffect(() => setAmbient("idle"), [setAmbient]);

  const earned: Record<string, boolean> = {
    first: completedNodes.length >= 1,
    streak: streak >= 7,
    levelup: level >= 3,
    perfect: completedNodes.length >= 2,
  };

  const levelFloor = xpForLevel(level) + 200;
  const levelCeil = xpForLevel(level + 1) + 200;
  const levelProgress = Math.max(0, Math.min(1, (xp - levelFloor) / (levelCeil - levelFloor)));

  return (
    <div>
      <header className="mb-6 flex items-center gap-4 animate-fade-in">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/mascot/poses/happy.webp" alt="You" className="h-16 w-16 rounded-2xl bg-surface-alt object-contain p-1" />
        <div>
          <p className="font-display text-sm font-bold uppercase tracking-wide text-primary">Your progress</p>
          <h1 className="font-display text-display text-text">{name}</h1>
          <p className="capitalize text-muted">{persona ?? "learner"} · Level {level}</p>
        </div>
      </header>

      {/* Setup: name, keywords, article links — gates the Learn section */}
      <ProfileSetup />

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={<Zap className="h-5 w-5 text-amber" />} value={xp} label="Total XP" index={0} />
        <Stat icon={<Flame className="h-5 w-5 text-amber" />} value={streak} label="Day streak" index={1} />
        <Stat icon={<Newspaper className="h-5 w-5 text-secondary" />} value={articlesReadIds.length} label="Articles read" index={2} />
        <Stat icon={<CheckCircle2 className="h-5 w-5 text-success" />} value={completedNodes.length} label="Units done" index={3} />
      </div>

      {/* Level + hearts */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <div className="card flex items-center gap-4 p-5">
          <ProgressRing value={levelProgress} size={84}>
            <div className="text-center leading-none">
              <div className="font-display text-2xl font-extrabold text-text">{level}</div>
              <div className="text-[10px] font-bold text-muted">level</div>
            </div>
          </ProgressRing>
          <div>
            <p className="font-display text-h3 text-text">Level {level}</p>
            <p className="text-sm text-muted">{levelCeil - xp} XP to level {level + 1}</p>
          </div>
        </div>
        <div className="card flex flex-col justify-center gap-2 p-5">
          <p className="font-display text-h3 text-text">Hearts</p>
          <Hearts count={hearts} max={maxHearts} size={26} />
          <p className="text-sm text-muted">Lose one on a wrong answer; refill when you run out.</p>
        </div>
      </div>

      {/* Skill scores */}
      <div className="card mb-6 p-5">
        <h2 className="mb-4 font-display text-h3 text-text">Skill Score by topic</h2>
        <div className="flex flex-col gap-4">
          {topicScores.map((t) => (
            <div key={t.topic}>
              <div className="mb-1 flex items-center justify-between">
                <span className="font-semibold text-text">{t.topic}</span>
                <span className="font-display text-lg font-extrabold text-primary">{skillScore(t)}</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-chip bg-surface-alt">
                <div className="h-full rounded-chip bg-primary transition-all duration-700" style={{ width: `${skillScore(t)}%` }} />
              </div>
              <div className="mt-1 flex gap-4 text-xs text-muted">
                <span>Mastery {t.mastery}</span>
                <span>Currency {t.currency}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Badges */}
      <div className="card mb-6 p-5">
        <h2 className="mb-4 font-display text-h3 text-text">Badges</h2>
        <div className="grid grid-cols-4 gap-3">
          {BADGES.map((b) => (
            <div key={b.id} className="flex flex-col items-center gap-2 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={b.img}
                alt={b.label}
                className={cn("h-16 w-16 object-contain transition-all", earned[b.id] ? "drop-shadow-[0_4px_10px_rgba(255,122,26,.35)]" : "opacity-25 grayscale")}
              />
              <span className={cn("text-xs font-semibold", earned[b.id] ? "text-text" : "text-muted")}>{b.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Integration availability — full vs degraded/mock mode + Hermes skills (30d) */}
      <IntegrationsPanel />

      <Button variant="ghost" onClick={() => { resetOnboarding(); router.push("/onboarding"); }}>
        <RotateCcw className="h-4 w-4" /> Restart onboarding
      </Button>
    </div>
  );
}

function Stat({ icon, value, label, index = 0 }: { icon: React.ReactNode; value: React.ReactNode; label: string; index?: number }) {
  return (
    <div
      className="card flex flex-col gap-1 p-4 animate-rise"
      style={{ animationDelay: `${index * 70}ms`, animationFillMode: "backwards" }}
    >
      <div className="flex items-center gap-1.5">{icon}</div>
      <div className="font-display text-2xl font-extrabold text-text">{value}</div>
      <div className="text-xs font-semibold text-muted">{label}</div>
    </div>
  );
}
