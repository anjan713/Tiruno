"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Newspaper, Trophy, Play, Heart, Star, GripVertical, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Mascot } from "@/components/mascot/Mascot";
import { useGameStore } from "@/lib/store/useGameStore";
import { useMascot } from "@/components/mascot/MascotProvider";
import { playSfx } from "@/lib/sound/sfx";
import { getLearnTracks, type SkillNode, type NodeType } from "@/lib/mock/data";
import {
  buildBookmarkTracks,
  buildDailyTracks,
  buildInterestTracks,
  buildPrerequisiteTracks,
  type BookmarkArticle,
  type PendingPrereq,
} from "@/lib/learn/bookmarkTracks";
import { useSectionOrdering } from "@/lib/learn/useSectionOrdering";
import { learnGate } from "@/lib/learn/gate";
import { LearnLocked } from "@/components/learn/LearnLocked";
import { SkillNode as PathNode } from "@/components/learn/SkillNode";

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
  const interestArticleIds = useGameStore((s) => s.interestArticleIds);
  const interestKeywords = useGameStore((s) => s.interestKeywords);
  const { setAmbient } = useMascot();
  const [selected, setSelected] = useState<SkillNode | null>(null);
  const [articles, setArticles] = useState<BookmarkArticle[] | null>(null);
  const [prereqs, setPrereqs] = useState<PendingPrereq[]>([]);

  useEffect(() => setAmbient("idle"), [setAmbient]);

  // The Learn map is built primarily from the user's profile "articles of interest"
  // (plus any prerequisite sections the self-learning loop has queued). Poll so newly
  // added links appear as soon as Tiru finishes summarising them.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [aRes, pRes] = await Promise.all([fetch("/api/articles"), fetch("/api/prereq")]);
        const aData = await aRes.json().catch(() => ({}));
        const pData = await pRes.json().catch(() => ({}));
        if (cancelled) return;
        setArticles(Array.isArray(aData.articles) ? aData.articles : []);
        setPrereqs(Array.isArray(pData.prereqs) ? pData.prereqs : []);
      } catch {
        if (!cancelled) {
          setArticles([]);
          setPrereqs([]);
        }
      }
    };
    load();
    const t = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const tracks = useMemo(() => {
    const prereqTracks = buildPrerequisiteTracks(prereqs);
    // Primary content = the articles the user added in their profile (read here in Learn).
    const interest = articles ? buildInterestTracks(articles, interestArticleIds) : [];
    if (interest.length) return [...prereqTracks, ...interest];
    // Fallbacks while interest articles are still summarising / for legacy bookmarks.
    const bk = articles ? buildBookmarkTracks(articles) : [];
    if (bk.length) return [...prereqTracks, ...bk];
    const daily = articles ? buildDailyTracks(articles) : [];
    if (daily.length) return [...prereqTracks, ...daily];
    return getLearnTracks(persona, selectedCourses, selectedInterests);
  }, [persona, articles, prereqs, interestArticleIds, selectedCourses, selectedInterests]);

  const { orderedTracks, canReorderAny, drag, setDrag, overId, setOverId, moveUnit, nudge } =
    useSectionOrdering(tracks);

  const flat = useMemo(
    () => orderedTracks.flatMap((t) => t.units.flatMap((u) => u.nodes)),
    [orderedTracks]
  );
  const activeId = useMemo(() => flat.find((n) => !completed.includes(n.id))?.id, [flat, completed]);

  // Nothing is locked: lessons can be done in any order. The first uncompleted node is
  // flagged "active" (START + mascot) purely as a suggestion; the rest are "available".
  const statusOf = (n: SkillNode) =>
    completed.includes(n.id) ? "done" : n.id === activeId ? "active" : "available";

  const onNodeClick = (n: SkillNode) => {
    playSfx("ding");
    setSelected(n);
  };

  const start = (n: SkillNode) => {
    // Article nodes open the in-app reader — handles mock, daily, and the user's stored
    // interest articles (the reader loads stored articles by id).
    if (n.type === "article") {
      const cid = n.contentId ?? n.articleId;
      if (cid) router.push(`/article/${cid}?node=${n.id}`);
      return;
    }
    // Lesson nodes: carry article/topic so the lesson can be generated on demand.
    const cid = n.contentId || "l-security";
    const qs = new URLSearchParams({ node: n.id });
    if (n.articleId) qs.set("article", n.articleId);
    if (n.topic) qs.set("topic", n.topic);
    if (n.lessonIndex) qs.set("index", String(n.lessonIndex));
    if (n.lessonCount) qs.set("count", String(n.lessonCount));
    router.push(`/lesson/${cid}?${qs.toString()}`);
  };

  const gate = learnGate({ name, interestArticleIds, interestKeywords });
  if (!gate.unlocked) return <LearnLocked gate={gate} />;

  let idx = -1;

  return (
    <div>
      <header className="mb-8 animate-fade-in">
        <p className="font-display text-sm font-bold uppercase tracking-wide text-primary">Your path</p>
        <h1 className="font-display text-display text-text">Welcome back, {name}</h1>
        <p className="text-muted">Hop along the trail — Tiru is waiting at your next stop.</p>
        {canReorderAny && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
            <GripVertical className="h-3.5 w-3.5" /> Drag a section — or use the arrows — to reorder by priority.
          </p>
        )}
      </header>

      {orderedTracks.map((track) => (
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

          {track.units.map((unit, unitIdx) => {
            const canReorder = track.units.length > 1;
            return (
            <div
              key={unit.id}
              onDragOver={(e) => {
                if (drag && drag.trackId === track.courseId && drag.unitId !== unit.id) {
                  e.preventDefault();
                  setOverId(unit.id);
                }
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                  setOverId((id) => (id === unit.id ? null : id));
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (drag && drag.trackId === track.courseId) moveUnit(track.courseId, drag.unitId, unit.id);
                setDrag(null);
                setOverId(null);
              }}
              className={cn(
                "mb-8 rounded-2xl transition-all",
                overId === unit.id && drag?.unitId !== unit.id && "ring-2 ring-primary/50"
              )}
            >
              <div
                draggable={canReorder}
                onDragStart={(e) => {
                  setDrag({ trackId: track.courseId, unitId: unit.id });
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => {
                  setDrag(null);
                  setOverId(null);
                }}
                className={cn(
                  "sticky top-2 z-10 -mx-2 mb-8 flex items-center gap-2 rounded-2xl bg-primary px-4 py-3 shadow-[0_4px_0_rgb(var(--primary-press))] transition-all",
                  canReorder && "cursor-grab active:cursor-grabbing",
                  drag?.unitId === unit.id && "opacity-50"
                )}
              >
                {canReorder && <GripVertical className="h-5 w-5 shrink-0 text-primary-fg/70" aria-hidden />}
                <div className="min-w-0 flex-1">
                  <p className="font-display text-sm font-bold text-primary-fg">{unit.title}</p>
                  <p className="truncate text-xs text-primary-fg/80">{unit.subtitle}</p>
                </div>
                {canReorder && (
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      onClick={() => nudge(track.courseId, unit.id, -1)}
                      disabled={unitIdx === 0}
                      className="grid h-7 w-7 place-items-center rounded-lg text-primary-fg/90 transition-colors hover:bg-primary-fg/15 disabled:opacity-30"
                      aria-label={`Move ${unit.title} up`}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => nudge(track.courseId, unit.id, 1)}
                      disabled={unitIdx === track.units.length - 1}
                      className="grid h-7 w-7 place-items-center rounded-lg text-primary-fg/90 transition-colors hover:bg-primary-fg/15 disabled:opacity-30"
                      aria-label={`Move ${unit.title} down`}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* pt-6 leaves headroom for the active node's bobbing START callout,
                  which floats ~50px above the ring and must clear the unit header. */}
              <div className="flex flex-col items-center gap-7 pt-6">
                {unit.nodes.map((n) => {
                  idx += 1;
                  const status = statusOf(n);
                  const Icon = ICONS[n.type];
                  const offset = OFFSETS[idx % OFFSETS.length];
                  const isActive = status === "active";
                  return (
                    <div key={n.id} className="relative flex flex-col items-center" style={{ transform: `translateX(${offset}px)` }}>
                      <div className="relative">
                        {isActive ? (
                          <PathNode
                            status="active"
                            title={unit.title}
                            lessonCount={unit.nodes.length}
                            progress={
                              unit.nodes.filter((x) => completed.includes(x.id)).length / unit.nodes.length
                            }
                            icon={Icon}
                            onClick={() => onNodeClick(n)}
                          />
                        ) : (
                          <PathNode
                            status={status === "done" ? "done" : "available"}
                            title={n.title}
                            icon={Icon}
                            onClick={() => onNodeClick(n)}
                          />
                        )}
                      </div>
                      <span className="mt-3.5 max-w-[150px] text-center font-display text-sm font-bold text-text">
                        {n.title}
                      </span>

                      {isActive && (
                        <div className="pointer-events-none absolute left-full top-0 hidden md:block" style={{ marginLeft: 16 }}>
                          <Mascot state="idle" size={92} float lean />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            );
          })}
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
