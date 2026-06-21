import type Redis from "ioredis";
import type { ExploreSource } from "../agents/curator";

/**
 * L2 — Self-evolving discovery + self-grading (Hermes-pattern, low-footprint).
 * Proposes follow-up research topics from a session, records the yes/no reward,
 * and a Curator step rewrites a versioned discovery strategy.
 */

const suggestionsKey = (uid: string) => `suggestions:${uid}`;
const seenSourcesKey = (uid: string) => `seen_sources:${uid}`;
const seenAuthorsKey = (uid: string) => `seen_authors:${uid}`;
const strategyKey = (uid: string) => `strategy:discovery:${uid}`;
const IMPROVEMENTS = "improvements:log";

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
  try {
    await redis.lpush(
      `${suggestionsKey(uid)}:outcomes`,
      JSON.stringify({ followup, accepted, at: Date.now() })
    );
    await redis.ltrim(`${suggestionsKey(uid)}:outcomes`, 0, 199);
  } catch {
    /* best effort */
  }
}

interface StrategyVersion {
  version: number;
  noveltyExplore: number; // 0..1 share devoted to new authors/sources
  sourceMix: string[];
  note: string;
  at: number;
}

/**
 * Curator step: grade past suggestions vs accept rate, then write a new versioned
 * discovery strategy + an improvements-log entry. Runs after a session / on schedule.
 */
export async function runCurate(redis: Redis, uid: string): Promise<StrategyVersion> {
  let accepts = 0;
  let total = 0;
  try {
    const raw = await redis.lrange(`${suggestionsKey(uid)}:outcomes`, 0, 49);
    for (const r of raw) {
      try {
        const o = JSON.parse(r);
        total += 1;
        if (o.accepted) accepts += 1;
      } catch {
        /* skip */
      }
    }
  } catch {
    /* best effort */
  }

  const acceptRate = total ? accepts / total : 0.5;
  // Low accept rate → explore more new voices; high accept rate → exploit what works.
  const noveltyExplore = Math.max(0.1, Math.min(0.5, total ? 0.2 + (0.5 - acceptRate) * 0.4 : 0.2));

  let prevVersion = 0;
  try {
    const last = await redis.lindex(strategyKey(uid), 0);
    if (last) prevVersion = JSON.parse(last).version ?? 0;
  } catch {
    /* none yet */
  }

  const version: StrategyVersion = {
    version: prevVersion + 1,
    noveltyExplore: Number(noveltyExplore.toFixed(2)),
    sourceMix: ["reddit", "hackernews", "github", "youtube", "x", "web"],
    note:
      total === 0
        ? "Seed strategy: balanced sources, 20% explore for new voices."
        : `Tuned from ${total} outcomes (accept ${(acceptRate * 100).toFixed(0)}%) → explore ${(noveltyExplore * 100).toFixed(0)}%.`,
    at: Date.now(),
  };

  try {
    await redis.lpush(strategyKey(uid), JSON.stringify(version));
    await redis.ltrim(strategyKey(uid), 0, 19); // keep last 20 versions for before/after
    await redis.lpush(
      IMPROVEMENTS,
      JSON.stringify({ uid, version: version.version, note: version.note, at: version.at })
    );
    await redis.ltrim(IMPROVEMENTS, 0, 199);
  } catch {
    /* best effort */
  }
  return version;
}
