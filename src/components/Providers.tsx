"use client";

import { useEffect } from "react";
import { MascotProvider } from "@/components/mascot/MascotProvider";
import { useGameStore } from "@/lib/store/useGameStore";
import { setSfxMuted } from "@/lib/sound/sfx";

export function Providers({ children }: { children: React.ReactNode }) {
  const theme = useGameStore((s) => s.theme);
  const muted = useGameStore((s) => s.muted);

  useEffect(() => {
    useGameStore.persist.rehydrate();
  }, []);

  // Persist changes to Redis, keyed by the ACTIVE profile (per-profile tracking).
  // Loading happens via applyProfile() on login/switch, so we only save here.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const DATA_KEYS = [
      "onboarded", "profileId", "name", "persona", "selectedCourses", "selectedInterests",
      "xp", "level", "streak", "hearts", "maxHearts", "dailyXp", "dailyGoal",
      "completedNodes", "topicScores", "theme", "muted",
    ] as const;
    const snapshot = (s: Record<string, unknown>) =>
      Object.fromEntries(DATA_KEYS.map((k) => [k, s[k]]));

    const unsub = useGameStore.subscribe((s) => {
      if (!s._hasHydrated || !s.profileId) return;
      clearTimeout(t);
      t = setTimeout(() => {
        fetch(`/api/state?profile=${s.profileId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: snapshot(s as unknown as Record<string, unknown>) }),
        }).catch(() => {});
      }, 600);
    });

    return () => {
      clearTimeout(t);
      unsub();
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    setSfxMuted(muted);
  }, [muted]);

  return <MascotProvider>{children}</MascotProvider>;
}
