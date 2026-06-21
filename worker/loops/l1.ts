import type Redis from "ioredis";

/**
 * L1 — Personalization loop. Learns the user's level per topic from implicit signals
 * and exposes a prompt hint so generated content lands at the right depth.
 */

export type Level = "eli5" | "intermediate" | "expert";
export type SignalKind = "answer_correct" | "answer_wrong" | "skip" | "replay" | "ask" | "explore" | "listen";

const signalsKey = (uid: string) => `signals:${uid}`;
const understandingKey = (uid: string, topic: string) => `understanding:${uid}:${topic.toLowerCase()}`;

/** Record a raw implicit signal onto the user's signal stream. */
export async function recordSignal(
  redis: Redis,
  uid: string,
  signal: { kind: SignalKind; topic?: string; meta?: string }
): Promise<void> {
  try {
    await redis.xadd(
      signalsKey(uid),
      "MAXLEN",
      "~",
      1000,
      "*",
      "kind",
      signal.kind,
      "topic",
      signal.topic ?? "",
      "meta",
      signal.meta ?? "",
      "at",
      String(Date.now())
    );
  } catch {
    /* best effort */
  }
}

/** Nudge the understanding score for a topic. Score in [0,100]; mapped to a level. */
export async function bumpUnderstanding(redis: Redis, uid: string, topic: string, delta: number): Promise<number> {
  const key = understandingKey(uid, topic);
  try {
    const cur = Number((await redis.hget(key, "score")) ?? 40);
    const next = Math.max(0, Math.min(100, cur + delta));
    await redis.hset(key, "score", String(next), "topic", topic, "updatedAt", String(Date.now()));
    return next;
  } catch {
    return 40;
  }
}

export function scoreToLevel(score: number): Level {
  if (score < 33) return "eli5";
  if (score < 67) return "intermediate";
  return "expert";
}

/** Current level for a topic (defaults to intermediate when unseen). */
export async function getLevel(redis: Redis, uid: string, topic: string): Promise<Level> {
  try {
    const score = Number((await redis.hget(understandingKey(uid, topic), "score")) ?? 50);
    return scoreToLevel(score);
  } catch {
    return "intermediate";
  }
}

/** A short instruction injected into content/synthesis prompts to match the user's level. */
export function levelPromptHint(level: Level): string {
  switch (level) {
    case "eli5":
      return "Explain from first principles in plain language; define jargon; keep it simple and concrete.";
    case "expert":
      return "Assume strong background; be concise and technical; skip basics and focus on nuance, trade-offs, and what's new.";
    default:
      return "Assume some background; balance clarity with depth; briefly define non-obvious terms.";
  }
}
