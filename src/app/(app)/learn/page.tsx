"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Newspaper, Trophy, Check, Lock, Play, Heart, Star } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Mascot } from "@/components/mascot/Mascot";
import { useGameStore } from "@/lib/store/useGameStore";
import { useMascot } from "@/components/mascot/MascotProvider";
import { playSfx } from "@/lib/sound/sfx";
import { getLearnTracks, type SkillNode, type NodeType } from "@/lib/mock/data";

const OFFSETS = [0, 64, 92, 64, 0, -64, -92, -64];
const ICONS: Record<NodeType, React.ElementType> = {
  lesson: BookOpen,
  article: Newspaper,
  checkpoint: Trophy,
  review: Star,
};

export default function LearnPage() {
  const router = useRouter();
  const completed = useGameStore((s) => s.completedNodes);
  const name = useGameStore((s) => s.name);
  const persona = useGameStore((s) => s.persona);
  const selectedCourses = useGameStore((s) => s.selectedCourses);
  const selectedInterests = useGameStore((s) => s.selectedInterests);
  const { setAmbient } = useMascot();
  const [selected, setSelected] = useState<SkillNode | null>(null);

  useEffect(() => setAmbient("idle"), [setAmbient]);

  const tracks = useMemo(
    () => getLearnTracks(persona, selectedCourses, selectedInterests),
    [persona, selectedCourses, selectedInterests]
  );
  const flat = useMemo(() => tracks.flatMap((t) => t.units.flatMap((u) => u.nodes)), [tracks]);
  const activeId = useMemo(() => flat.find((n) => !completed.includes(n.id))?.id, [flat, completed]);

  const statusOf = (n: SkillNode) =>
    completed.includes(n.id) ? "done" : n.id === activeId ? "active" : "locked";

  const onNodeClick = (n: SkillNode) => {
    const status = statusOf(n);
    if (status === "locked") {
      playSfx("boing");
      return;
    }
    playSfx("ding");
    setSelected(n);
  };

  const start = (n: SkillNode) => {
    if (n.type === "article" && n.contentId) router.push(`/article/${n.contentId}`);
    else if (n.contentId) router.push(`/lesson/${n.contentId}?node=${n.id}`);
    else router.push(`/lesson/l-security?node=${n.id}`);
  };

  let idx = -1;

  return (
    <div>
      <header className="mb-8 animate-fade-in">
        <p className="font-display text-sm font-bold uppercase tracking-wide text-primary">Your path</p>
        <h1 className="font-display text-display text-text">Welcome back, {name}</h1>
        <p className="text-muted">Hop along the trail — Tiru is waiting at your next stop.</p>
      </header>

      {tracks.map((track) => (
        <section key={track.courseId} className="mb-12">
          <div className="mb-5 flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 font-display text-sm font-extrabold text-primary">
              {track.code.split(" ")[1] ?? "•"}
            </span>
            <div>
              <p className="font-display text-xs font-bold uppercase tracking-wide text-primary">{track.code}</p>
              <h2 className="font-display text-h3 text-text">{track.name}</h2>
            </div>
          </div>

          {track.units.map((unit) => (
            <div key={unit.id} className="mb-8">
              <div className="sticky top-0 z-10 -mx-2 mb-6 rounded-btn bg-primary/90 px-4 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-primary/80">
                <p className="font-display text-sm font-bold text-primary-fg">{unit.title}</p>
                <p className="text-xs text-primary-fg/80">{unit.subtitle}</p>
              </div>

              <div className="flex flex-col items-center gap-3">
                {unit.nodes.map((n) => {
                  idx += 1;
                  const status = statusOf(n);
                  const Icon = ICONS[n.type];
                  const offset = OFFSETS[idx % OFFSETS.length];
                  const isActive = status === "active";
                  return (
                    <div key={n.id} className="relative flex flex-col items-center" style={{ transform: `translateX(${offset}px)` }}>
                      <button
                        onClick={() => onNodeClick(n)}
                        className={cn(
                          "group relative grid h-[76px] w-[76px] place-items-center rounded-full border-4 transition-all",
                          status === "done" && "border-success bg-success text-white shadow-soft",
                          status === "active" && "animate-pulse-ring border-primary bg-surface text-primary hover:-translate-y-1",
                          status === "locked" && "border-border bg-surface-alt text-muted"
                        )}
                        aria-label={`${n.title} (${status})`}
                      >
                        {status === "done" ? (
                          <Check className="h-8 w-8" />
                        ) : status === "locked" ? (
                          <Lock className="h-6 w-6" />
                        ) : (
                          <Icon className="h-8 w-8" />
                        )}
                        {isActive && (
                          <span className="absolute -top-2 -right-2 rounded-chip bg-primary px-2 py-0.5 font-display text-[10px] font-extrabold text-primary-fg shadow-soft">
                            START
                          </span>
                        )}
                      </button>
                      <span className={cn("mt-2 max-w-[140px] text-center text-sm font-semibold", status === "locked" ? "text-muted" : "text-text")}>
                        {n.title}
                      </span>

                      {isActive && (
                        <div className="pointer-events-none absolute left-full top-0 hidden md:block" style={{ marginLeft: 8 }}>
                          <Mascot state="idle" size={92} float lean />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      ))}

      {selected && (
        <div className="fixed inset-0 z-50 grid place-items-end sm:place-items-center bg-black/40 p-4 animate-[rise_0.25s_ease-out]" onClick={() => setSelected(null)}>
          <div className="card w-full max-w-sm p-6 animate-pop" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                {(() => {
                  const I = ICONS[selected.type];
                  return <I className="h-6 w-6" />;
                })()}
              </span>
              <div>
                <h3 className="font-display text-h3 text-text">{selected.title}</h3>
                <p className="text-sm capitalize text-muted">{selected.type}</p>
              </div>
            </div>
            <div className="mb-5 flex items-center gap-4 text-sm font-semibold text-muted">
              <span className="flex items-center gap-1"><Star className="h-4 w-4 text-amber" /> +{selected.xp} XP</span>
              <span className="flex items-center gap-1"><Heart className="h-4 w-4 text-danger" /> 5 hearts</span>
            </div>
            <Button block size="lg" onClick={() => start(selected)}>
              <Play className="h-5 w-5" /> Start
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
