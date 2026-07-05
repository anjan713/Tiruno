// Hermes — a self-improving agent loop.
//
// Cycle: ACT (an agent runs a task) -> RECORD (episodic memory) -> REFLECT
// (self-grade recent outcomes) -> EVOLVE (rewrite the discovery strategy and,
// when warranted, author/refine a skill). Strategies, skills, reflections, and
// episodes all live as markdown in the Vault, so the agent's growth is durable
// and human-inspectable in Obsidian.

export interface HermesEpisode {
  id: string;
  uid: string;
  /** Task kind, e.g. "explore" | "lesson" | "narrate". */
  task: string;
  topic?: string;
  strategyVersion: number;
  /** One-line description of what was attempted. */
  input: string;
  /** One-line description of what was produced. */
  output: string;
  /** Numeric outcome signals, e.g. { sources: 8, novelSources: 3 }. */
  metrics: Record<string, number>;
  at: number;
}

/** The evolving discovery policy the curator consults before researching. */
export interface DiscoveryStrategy {
  version: number;
  /** 0..1 share of effort spent on new/novel sources vs proven ones. */
  noveltyExplore: number;
  sourceMix: string[];
  /** Sources/authors that have performed well (favor these). */
  preferred: string[];
  /** Sources/authors that underperformed (de-emphasize these). */
  avoid: string[];
  /** Human-readable rationale for this version. */
  note: string;
  at: number;
}

/** A learned, reusable playbook the agent writes and refines over time. */
export interface HermesSkill {
  name: string;
  /** When this skill applies. */
  when: string;
  /** Ordered steps to follow. */
  steps: string[];
  version: number;
  at: number;
}

/** Output of a reflection pass. */
export interface Reflection {
  /** Self-graded quality of recent work, 0..1. */
  score: number;
  critique: string;
  /** Proposed changes to merge into the next strategy version. */
  adjustments: Partial<Omit<DiscoveryStrategy, "version" | "at">>;
  /** Optional new/updated skill distilled from what worked. */
  skill?: Omit<HermesSkill, "version" | "at">;
}

export interface OutcomeStats {
  total: number;
  accepts: number;
  acceptRate: number;
}

export const DEFAULT_STRATEGY: DiscoveryStrategy = {
  version: 1,
  noveltyExplore: 0.2,
  sourceMix: ["reddit", "hackernews", "github", "youtube", "x", "web"],
  preferred: [],
  avoid: [],
  note: "Seed strategy: balanced sources, 20% explore for new voices.",
  at: 0,
};
