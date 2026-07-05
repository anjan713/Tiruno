// Skill-score model, isolated as pure functions (SRP) so both the store (writes) and the
// presentational components (reads) depend on the same abstraction (DIP).
//
// A topic's score blends two signals:
//   - mastery  (0-100): how well you know it. Grows with each completed lesson/article,
//     weighted by quiz accuracy, with diminishing returns as you approach 100.
//   - currency (0-100): how *current* that knowledge is. Refreshed when you engage the
//     topic and decays a little each day you don't — so stale topics drift down on their
//     own without any write, exactly like real knowledge going out of date.

import type { TopicScore } from "@/lib/mock/data";
import { todayKey, daysBetween, clamp } from "@/lib/date";

const CURRENCY_DECAY_PER_DAY = 3; // points lost per idle day
const MASTERY_LEARN_RATE = 0.18; // fraction of the remaining gap closed per session

/** Currency after applying time decay since the topic's last activity. */
export function currencyOf(t: TopicScore, today: string = todayKey()): number {
  if (!t.lastActive) return t.currency;
  const idleDays = Math.max(0, daysBetween(t.lastActive, today));
  return clamp(t.currency - idleDays * CURRENCY_DECAY_PER_DAY, 0, 100);
}

/** Blended 0-100 score using mastery and *decayed* currency. */
export function skillScore(t: TopicScore, today: string = todayKey()): number {
  return Math.round(t.mastery * 0.65 + currencyOf(t, today) * 0.35);
}

/**
 * Advance one topic by a single learning session and return a NEW list.
 * `accuracyPct` is the quiz score (0-100); reading an article passes a moderate value.
 * Unknown topics are appended so newly studied subjects start showing a score.
 */
export function applyTopicProgress(
  scores: TopicScore[],
  topic: string,
  accuracyPct: number,
  today: string = todayKey()
): TopicScore[] {
  const name = topic.trim();
  if (!name) return scores;

  const a = clamp(accuracyPct, 0, 100) / 100;
  const idx = scores.findIndex((s) => s.topic.toLowerCase() === name.toLowerCase());
  const base: TopicScore = idx >= 0 ? scores[idx] : { topic: name, mastery: 0, currency: 0 };

  // Mastery: close part of the gap to 100, weighted by accuracy (a weak session still
  // teaches a little; a strong one moves the needle more). Always at least +1.
  const gain = Math.round((100 - base.mastery) * MASTERY_LEARN_RATE * (0.35 + 0.65 * a));
  const mastery = clamp(base.mastery + Math.max(1, gain), 0, 100);

  // Currency: engaging fresh content makes the knowledge current again.
  const currency = clamp(Math.max(currencyOf(base, today), 78) + 12, 0, 100);

  const updated: TopicScore = { ...base, mastery, currency, lastActive: today };
  if (idx < 0) return [...scores, updated];

  const next = scores.slice();
  next[idx] = updated;
  return next;
}
