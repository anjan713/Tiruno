"use client";

// Section (unit) reordering for the Learn page, extracted from the page component so
// the component stays presentational (SRP). Generic over the minimal track shape it
// needs (ISP) and persists priority through the game store (DIP — the page never
// touches the store's ordering slice directly).

import { useCallback, useMemo, useState } from "react";
import { useGameStore } from "@/lib/store/useGameStore";
import { playSfx } from "@/lib/sound/sfx";

interface OrderableTrack {
  courseId: string;
  units: { id: string }[];
}

export interface SectionDrag {
  trackId: string;
  unitId: string;
}

export interface SectionOrdering<T extends OrderableTrack> {
  /** Tracks with their units re-sorted by the user's saved priority. */
  orderedTracks: T[];
  /** True when any track has more than one section (so reordering is meaningful). */
  canReorderAny: boolean;
  /** In-flight drag descriptor (the section being dragged), or null. */
  drag: SectionDrag | null;
  setDrag: (value: SectionDrag | null | ((prev: SectionDrag | null) => SectionDrag | null)) => void;
  /** Id of the section currently hovered as a drop target, or null. */
  overId: string | null;
  setOverId: (value: string | null | ((prev: string | null) => string | null)) => void;
  /** Move `fromId` to `toId`'s position within a track and persist. */
  moveUnit: (trackId: string, fromId: string, toId: string) => void;
  /** Nudge a section up (-1) or down (1) by one slot and persist. */
  nudge: (trackId: string, unitId: string, dir: -1 | 1) => void;
}

/** Apply the user's saved section priority; new/unsaved units keep their natural order. */
function orderUnits<U extends { id: string }>(saved: string[] | undefined, units: U[]): U[] {
  if (!saved?.length) return units;
  const byId = new Map(units.map((u) => [u.id, u] as const));
  const ordered: U[] = [];
  for (const id of saved) {
    const u = byId.get(id);
    if (u) {
      ordered.push(u);
      byId.delete(id);
    }
  }
  for (const u of units) if (byId.has(u.id)) ordered.push(u);
  return ordered;
}

export function useSectionOrdering<T extends OrderableTrack>(tracks: T[]): SectionOrdering<T> {
  const sectionOrder = useGameStore((s) => s.sectionOrder);
  const setSectionOrder = useGameStore((s) => s.setSectionOrder);

  const [drag, setDrag] = useState<SectionDrag | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const orderedTracks = useMemo(
    () => tracks.map((t) => ({ ...t, units: orderUnits(sectionOrder[t.courseId], t.units) })),
    [tracks, sectionOrder]
  );

  const canReorderAny = useMemo(() => orderedTracks.some((t) => t.units.length > 1), [orderedTracks]);

  const persistOrder = useCallback(
    (trackId: string, ids: string[]) => {
      setSectionOrder(trackId, ids);
      playSfx("ding");
    },
    [setSectionOrder]
  );

  const moveUnit = useCallback(
    (trackId: string, fromId: string, toId: string) => {
      const track = orderedTracks.find((t) => t.courseId === trackId);
      if (!track) return;
      const ids = track.units.map((u) => u.id);
      const from = ids.indexOf(fromId);
      const to = ids.indexOf(toId);
      if (from < 0 || to < 0 || from === to) return;
      ids.splice(from, 1);
      ids.splice(to, 0, fromId);
      persistOrder(trackId, ids);
    },
    [orderedTracks, persistOrder]
  );

  const nudge = useCallback(
    (trackId: string, unitId: string, dir: -1 | 1) => {
      const track = orderedTracks.find((t) => t.courseId === trackId);
      if (!track) return;
      const ids = track.units.map((u) => u.id);
      const i = ids.indexOf(unitId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      persistOrder(trackId, ids);
    },
    [orderedTracks, persistOrder]
  );

  return { orderedTracks, canReorderAny, drag, setDrag, overId, setOverId, moveUnit, nudge };
}
