// Deterministic learning plan — NO LLM here (see design/architecture.md §3-4).
//
// Two responsibilities, both pure functions of their inputs:
//   1. lessonCountForText: how many lessons an article should produce (from length).
//   2. Prerequisite graph + gap analysis: which concept a struggling learner is
//      missing (e.g. "I don't know Docker" for an AWS Fargate article), so we can
//      reprioritise the prerequisite *before* the blocked topic.
//
// Keeping this deterministic means it's unit-testable and free: the LLM is only
// used to interpret genuinely ambiguous free-text feedback (see analyzeFeedbackGap).

// ── 1. Length → lesson count ────────────────────────────────────────────────

export type LengthBucket = "short" | "medium" | "long" | "epic";

const LESSONS_FALLBACK_MAX = 4;

/** Word-count thresholds → bucket. Boundaries are inclusive of the lower bound. */
export function lengthBucket(words: number): LengthBucket {
  if (words < 800) return "short";
  if (words < 2500) return "medium";
  if (words <= 5000) return "long";
  return "epic";
}

const BUCKET_LESSONS: Record<LengthBucket, number> = {
  short: 1,
  medium: 2,
  long: 3,
  epic: 4,
};

export function countWords(text: string): number {
  return (text || "").trim().split(/\s+/).filter(Boolean).length;
}

/** Lessons to generate for an article, derived purely from its length. */
export function lessonCountForText(text: string, max = lessonsMax()): number {
  const n = BUCKET_LESSONS[lengthBucket(countWords(text))];
  return Math.max(1, Math.min(max, n));
}

function lessonsMax(): number {
  const v = Number(
    (typeof process !== "undefined" && process.env?.LESSONS_MAX) || LESSONS_FALLBACK_MAX
  );
  return Number.isFinite(v) && v > 0 ? v : LESSONS_FALLBACK_MAX;
}

// ── 2. Prerequisite concept graph ───────────────────────────────────────────

export type ConceptId = string;

export interface Concept {
  id: ConceptId;
  label: string;
  /** Lowercased keywords/phrases that signal this concept is present. */
  aliases: string[];
  /** Concept ids this one depends on (must-know-first). */
  prereqs: ConceptId[];
}

// A small, extensible registry covering the cloud/devops/AI domains the demo uses.
// Order independent; relationships are explicit (deterministic), never guessed.
export const CONCEPTS: Record<ConceptId, Concept> = {
  containers: {
    id: "containers",
    label: "Containers",
    aliases: ["container", "containerization", "containerisation", "oci image"],
    prereqs: [],
  },
  docker: {
    id: "docker",
    label: "Docker",
    aliases: ["docker", "dockerfile", "docker image", "docker container"],
    prereqs: ["containers"],
  },
  kubernetes: {
    id: "kubernetes",
    label: "Kubernetes",
    aliases: ["kubernetes", "k8s", "kubectl", "pod", "helm"],
    prereqs: ["docker"],
  },
  "aws-fargate": {
    id: "aws-fargate",
    label: "AWS Fargate",
    aliases: ["fargate", "aws fargate", "ecs fargate"],
    prereqs: ["docker"],
  },
  ecs: {
    id: "ecs",
    label: "Amazon ECS",
    aliases: ["amazon ecs", "elastic container service", " ecs "],
    prereqs: ["docker"],
  },
  embeddings: {
    id: "embeddings",
    label: "Embeddings",
    aliases: ["embedding", "embeddings", "vector representation"],
    prereqs: [],
  },
  "vector-search": {
    id: "vector-search",
    label: "Vector search",
    aliases: ["vector search", "nearest neighbor", "ann", "hnsw", "vector database"],
    prereqs: ["embeddings"],
  },
  rag: {
    id: "rag",
    label: "Retrieval-Augmented Generation",
    aliases: ["rag", "retrieval-augmented", "retrieval augmented generation"],
    prereqs: ["embeddings", "vector-search"],
  },
  "distributed-systems": {
    id: "distributed-systems",
    label: "Distributed systems",
    aliases: ["distributed system", "consensus", "replication", "partition"],
    prereqs: [],
  },
  idempotency: {
    id: "idempotency",
    label: "Idempotency",
    aliases: ["idempotent", "idempotency", "retry safe"],
    prereqs: ["distributed-systems"],
  },
};

const norm = (s: string) => ` ${(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `;

/** Count whole-token occurrences of `alias` inside an already-normalised haystack. */
function countMentions(normHay: string, alias: string): number {
  const token = ` ${norm(alias).trim()} `;
  if (token.trim() === "") return 0;
  let hits = 0;
  let idx = normHay.indexOf(token);
  while (idx !== -1) {
    hits += 1;
    idx = normHay.indexOf(token, idx + 1);
  }
  return hits;
}

const mentions = (normHay: string, alias: string): boolean => countMentions(normHay, alias) > 0;

/** All registered concepts whose aliases appear in the text, by descending hit count. */
export function matchConceptsInText(text: string): ConceptId[] {
  const hay = norm(text);
  const scored: Array<{ id: ConceptId; hits: number }> = [];
  for (const c of Object.values(CONCEPTS)) {
    const hits = c.aliases.reduce((n, a) => n + countMentions(hay, a), 0);
    if (hits > 0) scored.push({ id: c.id, hits });
  }
  scored.sort((a, b) => b.hits - a.hits);
  return scored.map((s) => s.id);
}

/** The single best-matching concept for an article (its primary subject), or null. */
export function identifyConcept(text: string): ConceptId | null {
  return matchConceptsInText(text)[0] ?? null;
}

/** Direct prerequisites of a concept. */
export function prerequisitesFor(id: ConceptId): ConceptId[] {
  return CONCEPTS[id]?.prereqs ?? [];
}

/** Full transitive prerequisite chain (topologically ordered, deepest first). */
export function prerequisiteChain(id: ConceptId): ConceptId[] {
  const out: ConceptId[] = [];
  const visit = (cid: ConceptId) => {
    for (const p of prerequisitesFor(cid)) {
      visit(p);
      if (!out.includes(p)) out.push(p);
    }
  };
  visit(id);
  return out;
}

export const conceptLabel = (id: ConceptId): string => CONCEPTS[id]?.label ?? id;

// ── 3. Outcome grading + gap analysis (deterministic) ───────────────────────

export type Outcome = "mastered" | "review" | "prereq";

/** Quiz score (0..100) → what to do next. */
export function gradeOutcome(scorePct: number): Outcome {
  if (scorePct >= 80) return "mastered";
  if (scorePct >= 50) return "review";
  return "prereq";
}

export interface GapResult {
  /** The missing prerequisite concept blocking the article's topic. */
  blocker: ConceptId;
  blockerLabel: string;
  /** The article's primary concept that depends on it. */
  topic: ConceptId;
  topicLabel: string;
  /** Ready-to-show suggestion text. */
  suggestion: string;
}

/**
 * Deterministic gap detection: given the article's concept and the learner's
 * free-text feedback, find a prerequisite of the article's concept that the
 * learner says they don't know.
 *
 * Example: article concept = "aws-fargate" (prereq "docker"); feedback mentions
 * "docker" near a not-known phrase ⇒ blocker = "docker".
 *
 * Returns null when no prerequisite is clearly implicated (caller may then ask
 * the LLM to interpret the feedback — that's the only non-deterministic step).
 */
export function detectPrerequisiteGap(articleText: string, feedbackText: string): GapResult | null {
  const topic = identifyConcept(articleText);
  if (!topic) return null;
  const chain = prerequisiteChain(topic);
  if (!chain.length) return null;

  // This runs on the "why couldn't you answer?" feedback, so any prerequisite the
  // learner names there is implicated. Deepest prereq first (learn fundamentals first).
  const fb = norm(feedbackText);
  for (const pid of chain) {
    const named = CONCEPTS[pid].aliases.some((a) => mentions(fb, a));
    if (named) return buildGap(topic, pid);
  }
  return null;
}

function buildGap(topic: ConceptId, blocker: ConceptId): GapResult {
  const topicLabel = conceptLabel(topic);
  const blockerLabel = conceptLabel(blocker);
  return {
    blocker,
    blockerLabel,
    topic,
    topicLabel,
    suggestion:
      `Since ${topicLabel} builds on ${blockerLabel}, want to learn ${blockerLabel} basics first? ` +
      `I'll prioritise ${blockerLabel}, then we'll come back to ${topicLabel}.`,
  };
}
