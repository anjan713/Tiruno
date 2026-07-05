import type Redis from "ioredis";
import type { ExploreSource } from "../agents/curator";
import { getHermes, type DiscoveryStrategy } from "../../src/lib/core/hermes";
import type { RedisLike } from "../../src/lib/core/store/types";

/**
 * L2 — Self-evolving discovery + self-grading. Candidate follow-ups are proposed
 * here from a session; the yes/no reward and versioned strategy/skill evolution
 * are handled by the Hermes module (src/lib/core/hermes), which persists living
 * markdown files to the Vault and mirrors the strategy to Redis.
 */

const suggestionsKey = (uid: string) => `suggestions:${uid}`;
const seenSourcesKey = (uid: string) => `seen_sources:${uid}`;
const seenAuthorsKey = (uid: string) => `seen_authors:${uid}`;

const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "from", "what", "your", "you", "are", "how",
  "why", "new", "now", "best", "top", "vs", "use", "using", "into", "about", "over", "last",
  "days", "people", "say", "said", "want", "users", "guide", "tutorial",
]);

/** Lightweight follow-up extraction from source titles + synthesis (no extra LLM call). */
export async function proposeFollowups(
  redis: Redis,
  uid: string,
  topic: string,
  sources: ExploreSource[],
  synthesis: string
): Promise<string[]> {
  const text = [synthesis, ...sources.map((s) => `${s.title} ${s.snippet ?? ""}`)].join(" ");
  const topicWords = new Set(topic.toLowerCase().split(/\s+/));

  // Candidate phrases: Capitalized multi-word terms and notable single tokens.
  const counts = new Map<string, number>();
  const phraseRe = /\b([A-Z][a-zA-Z0-9.+#]+(?:\s+[A-Z][a-zA-Z0-9.+#]+){0,2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = phraseRe.exec(text))) {
    const phrase = m[1].trim();
    const lower = phrase.toLowerCase();
    if (phrase.length < 3) continue;
    if (topicWords.has(lower)) continue;
    if (lower.split(/\s+/).every((w) => STOP.has(w))) continue;
    counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }

  const ranked = [...counts.entries()]
    .filter(([p]) => !p.toLowerCase().includes(topic.toLowerCase()))
    .sort((a, b) => b[1] - a[1])
    .map(([p]) => p)
    .slice(0, 4);

  if (ranked.length) {
    try {
      const entry = JSON.stringify({ topic, followups: ranked, at: Date.now(), outcome: "pending" });
      await redis.lpush(suggestionsKey(uid), entry);
      await redis.ltrim(suggestionsKey(uid), 0, 49);
      // Track sources we've shown so future discovery can favor novel ones.
      for (const s of sources) if (s.source) await redis.sadd(seenSourcesKey(uid), s.source.toLowerCase());
      for (const s of sources) {
        try {
          const host = new URL(s.url).hostname.replace(/^www\./, "");
          if (host) await redis.sadd(seenAuthorsKey(uid), host);
        } catch {
          /* skip bad url */
        }
      }
    } catch {
      /* best effort */
    }
  }
  return ranked;
}

/** Record the user's yes/no on a proposed follow-up (the explicit reward signal). */
export async function recordSuggestionOutcome(
  redis: Redis,
  uid: string,
  followup: string,
  accepted: boolean
): Promise<void> {
  await getHermes(redis as unknown as RedisLike).recordOutcome(uid, followup, accepted);
}

/**
 * Curator step: Hermes self-grades recent outcomes and writes a new versioned
 * discovery strategy (+ optional learned skill + reflection) to the Vault.
 * Runs after a session / on schedule via the "curate" job.
 */
export async function runCurate(redis: Redis, uid: string): Promise<DiscoveryStrategy> {
  return getHermes(redis as unknown as RedisLike).reflectAndEvolve(uid);
}
