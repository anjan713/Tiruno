// Daily streak rule, isolated as a pure function so the store stays thin and the logic is
// unit-testable (SRP). A "day streak" is the number of consecutive calendar days on which
// the learner completed at least one node. It advances at most once per day and resets to
// 1 whenever a day is missed — the standard streak semantics.

import { todayKey, daysBetween } from "@/lib/date";

export interface StreakState {
  streak: number;
  /** Local date key (YYYY-M-D) the streak was last credited, or null if never. */
  lastStreakDate: string | null;
}

/**
 * Credit one day of activity toward the streak.
 * - same day as last credit  -> unchanged (one credit per day max)
 * - never credited before     -> keep the current count, just stamp today (preserves seeds)
 * - exactly one day later     -> +1 (consecutive)
 * - two or more days later    -> reset to 1 (a day was missed)
 * - clock went backwards       -> keep count, stamp today (defensive)
 */
export function creditDailyStreak(state: StreakState, today: string = todayKey()): StreakState {
  if (state.lastStreakDate === today) return state;
  if (!state.lastStreakDate) {
    return { streak: Math.max(1, state.streak), lastStreakDate: today };
  }
  const gap = daysBetween(state.lastStreakDate, today);
  if (gap === 1) return { streak: state.streak + 1, lastStreakDate: today };
  if (gap > 1) return { streak: 1, lastStreakDate: today };
  return { streak: state.streak, lastStreakDate: today };
}
