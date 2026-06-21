"use client";

import { Flame } from "lucide-react";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { Hearts } from "@/components/ui/Hearts";
import { useGameStore } from "@/lib/store/useGameStore";
import { skillScore } from "@/lib/mock/data";

export function ContextRail() {
  const { dailyXp, dailyGoal, streak, hearts, maxHearts, topicScores } = useGameStore();

  return (
    <aside className="hidden h-full w-[320px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-surface px-5 py-6 scroll-thin xl:flex">
      {/* Daily goal */}
      <div className="card flex items-center gap-4 p-4">
        <ProgressRing value={dailyXp / dailyGoal} size={76}>
          <div className="text-center leading-none">
            <div className="font-display text-xl font-extrabold text-text">{dailyXp}</div>
            <div className="text-[10px] font-bold text-muted">/{dailyGoal} XP</div>
          </div>
        </ProgressRing>
        <div>
          <p className="font-display text-h3 text-text">Daily goal</p>
          <p className="text-sm text-muted">{Math.max(0, dailyGoal - dailyXp)} XP to go today</p>
        </div>
      </div>

      {/* Streak + hearts */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card flex flex-col items-center justify-center gap-1 p-4">
          <Flame className="h-7 w-7 fill-amber/30 text-amber animate-flame" />
          <span className="font-display text-2xl font-extrabold text-text">{streak}</span>
          <span className="text-xs font-semibold text-muted">day streak</span>
        </div>
        <div className="card flex flex-col items-center justify-center gap-2 p-4">
          <Hearts count={hearts} max={maxHearts} size={16} />
          <span className="font-display text-2xl font-extrabold text-text">{hearts}</span>
          <span className="text-xs font-semibold text-muted">hearts</span>
        </div>
      </div>

      {/* Skill score mini */}
      <div className="card p-4">
        <p className="mb-3 font-display text-h3 text-text">Skill Score</p>
        <div className="flex flex-col gap-3">
          {topicScores.map((t) => {
            const score = skillScore(t);
            return (
              <div key={t.topic}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-semibold text-text">{t.topic}</span>
                  <span className="font-display font-extrabold text-primary">{score}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-chip bg-surface-alt">
                  <div className="h-full rounded-chip bg-primary transition-all duration-700" style={{ width: `${score}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
