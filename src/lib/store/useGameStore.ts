"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { PROFILES, type ProfileId } from "@/lib/mock/profiles";
import type { TopicScore } from "@/lib/mock/data";
import { creditDailyStreak } from "@/lib/learn/streak";
import { applyTopicProgress } from "@/lib/learn/skill";

export type Persona = "student" | "professional" | null;
export type Theme = "light" | "dark";

interface GameState {
  // identity / onboarding
  onboarded: boolean;
  profileId: ProfileId | "custom" | null;
  name: string;
  persona: Persona;
  selectedCourses: string[];
  selectedInterests: string[];

  // gamification
  xp: number;
  level: number;
  streak: number;
  hearts: number;
  maxHearts: number;
  dailyXp: number;
  dailyGoal: number;

  // progress
  completedNodes: string[];
  topicScores: TopicScore[];
  /** User-defined section (unit) priority per track: courseId -> ordered unit ids. */
  sectionOrder: Record<string, string[]>;
  /** Local date (YYYY-M-D) the daily streak was last advanced. */
  lastStreakDate: string | null;
  /** Unique ids of articles fully read in-app (drives the "articles read" metric). */
  articlesReadIds: string[];
  /** Free-text keywords of interest added in the profile (>=3 required to unlock Learn). */
  interestKeywords: string[];
  /** Article ids the user added as "articles of interest" (>=3 required to unlock Learn). */
  interestArticleIds: string[];

  // prefs
  theme: Theme;
  muted: boolean;

  // hydration
  _hasHydrated: boolean;
  setHasHydrated: (v: boolean) => void;

  // actions
  setName: (name: string) => void;
  setPersona: (p: Persona) => void;
  loadProfile: (id: ProfileId) => void;
  logout: () => void;
  toggleCourse: (id: string) => void;
  toggleInterest: (id: string) => void;
  finishOnboarding: () => void;
  resetOnboarding: () => void;

  addXp: (amount: number) => void;
  loseHeart: () => void;
  refillHearts: () => void;
  completeNode: (id: string) => void;
  markArticleRead: (articleId: string) => void;
  recordTopicProgress: (topic: string, accuracyPct: number) => void;
  addInterestKeyword: (keyword: string) => void;
  removeInterestKeyword: (keyword: string) => void;
  addInterestArticle: (id: string) => void;
  removeInterestArticle: (id: string) => void;
  setSectionOrder: (trackId: string, unitIds: string[]) => void;

  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setMuted: (m: boolean) => void;
  toggleMuted: () => void;
}

const xpForLevel = (level: number) => level * 100;

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      onboarded: false,
      profileId: null,
      name: "Raj",
      persona: null,
      selectedCourses: ["cmpe277", "cmpe273"],
      selectedInterests: [],

      xp: 240,
      level: 3,
      streak: 12,
      hearts: 5,
      maxHearts: 5,
      dailyXp: 10,
      dailyGoal: 40,

      completedNodes: ["a1"],
      topicScores: PROFILES.student.topicScores,
      sectionOrder: {},
      lastStreakDate: null,
      articlesReadIds: [],
      interestKeywords: [],
      interestArticleIds: [],

      theme: "light",
      muted: false,

      _hasHydrated: false,
      setHasHydrated: (v) => set({ _hasHydrated: v }),

      setName: (name) => set({ name }),
      setPersona: (persona) => set({ persona }),
      loadProfile: (id) => {
        const p = PROFILES[id];
        set({
          profileId: id,
          onboarded: true,
          name: p.name,
          persona: p.persona,
          selectedCourses: p.selectedCourses,
          selectedInterests: p.selectedInterests,
          xp: p.xp,
          level: p.level,
          streak: p.streak,
          hearts: p.hearts,
          maxHearts: p.maxHearts,
          dailyXp: p.dailyXp,
          dailyGoal: p.dailyGoal,
          completedNodes: p.completedNodes,
          topicScores: p.topicScores,
          lastStreakDate: null,
          articlesReadIds: [],
          interestKeywords: [],
          interestArticleIds: [],
        });
      },
      logout: () => set({ profileId: null, onboarded: false }),
      toggleCourse: (id) =>
        set((s) => ({
          selectedCourses: s.selectedCourses.includes(id)
            ? s.selectedCourses.filter((c) => c !== id)
            : [...s.selectedCourses, id],
        })),
      toggleInterest: (id) =>
        set((s) => ({
          selectedInterests: s.selectedInterests.includes(id)
            ? s.selectedInterests.filter((c) => c !== id)
            : [...s.selectedInterests, id],
        })),
      finishOnboarding: () => set({ onboarded: true, profileId: "custom" }),
      resetOnboarding: () =>
        set({ onboarded: false, persona: null, selectedInterests: [] }),

      addXp: (amount) =>
        set((s) => {
          const xp = s.xp + amount;
          const dailyXp = Math.min(s.dailyGoal + 20, s.dailyXp + amount);
          let level = s.level;
          while (xp >= xpForLevel(level + 1) + 200) level += 1;
          return { xp, dailyXp, level };
        }),
      loseHeart: () => set((s) => ({ hearts: Math.max(0, s.hearts - 1) })),
      refillHearts: () => set((s) => ({ hearts: s.maxHearts })),
      completeNode: (id) =>
        set((s) => {
          if (s.completedNodes.includes(id)) return s;
          const completedNodes = [...s.completedNodes, id];
          // Finishing any node counts as activity for the day -> advance the daily streak.
          // Consecutive-day logic (and reset-on-miss) lives in creditDailyStreak.
          const { streak, lastStreakDate } = creditDailyStreak(s);
          return { completedNodes, streak, lastStreakDate };
        }),
      markArticleRead: (articleId) =>
        set((s) =>
          s.articlesReadIds.includes(articleId)
            ? s
            : { articlesReadIds: [...s.articlesReadIds, articleId] }
        ),
      recordTopicProgress: (topic, accuracyPct) =>
        set((s) => ({ topicScores: applyTopicProgress(s.topicScores, topic, accuracyPct) })),
      addInterestKeyword: (keyword) =>
        set((s) => {
          const k = keyword.trim();
          if (!k || s.interestKeywords.some((x) => x.toLowerCase() === k.toLowerCase())) return s;
          return { interestKeywords: [...s.interestKeywords, k] };
        }),
      removeInterestKeyword: (keyword) =>
        set((s) => ({ interestKeywords: s.interestKeywords.filter((k) => k !== keyword) })),
      addInterestArticle: (id) =>
        set((s) => (s.interestArticleIds.includes(id) ? s : { interestArticleIds: [...s.interestArticleIds, id] })),
      removeInterestArticle: (id) =>
        set((s) => ({
          interestArticleIds: s.interestArticleIds.filter((x) => x !== id),
          articlesReadIds: s.articlesReadIds.filter((x) => x !== id),
        })),
      setSectionOrder: (trackId, unitIds) =>
        set((s) => ({ sectionOrder: { ...s.sectionOrder, [trackId]: unitIds } })),

      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((s) => ({ theme: s.theme === "light" ? "dark" : "light" })),
      setMuted: (muted) => set({ muted }),
      toggleMuted: () => set((s) => ({ muted: !s.muted })),
    }),
    {
      name: "tiruno-game-v3",
      skipHydration: true,
      onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
      partialize: (s) => ({
        onboarded: s.onboarded,
        profileId: s.profileId,
        name: s.name,
        persona: s.persona,
        topicScores: s.topicScores,
        selectedCourses: s.selectedCourses,
        selectedInterests: s.selectedInterests,
        xp: s.xp,
        level: s.level,
        streak: s.streak,
        hearts: s.hearts,
        dailyXp: s.dailyXp,
        dailyGoal: s.dailyGoal,
        completedNodes: s.completedNodes,
        sectionOrder: s.sectionOrder,
        lastStreakDate: s.lastStreakDate,
        articlesReadIds: s.articlesReadIds,
        interestKeywords: s.interestKeywords,
        interestArticleIds: s.interestArticleIds,
        theme: s.theme,
        muted: s.muted,
      }),
    }
  )
);

export { xpForLevel };
