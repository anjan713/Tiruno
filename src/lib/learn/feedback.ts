// Feedback analysis + self-learning. The end-of-lesson feedback is the highest
// signal we collect. Flow (see design/userflow.md §5-6):
//   1. grade the outcome (deterministic)
//   2. detect the blocking prerequisite from the free text (deterministic graph;
//      LLM only to interpret ambiguous text)
//   3. write a durable knowledge note to the Obsidian vault
//   4. record a Hermes episode so the agent learns from this interaction
// Persisting the prerequisite (reprioritisation) happens on user acceptance via
// recordPrereqAcceptance().

import { getRedis } from "@/lib/redis";
import { getLLM } from "@/lib/core/llm";
import { getVault } from "@/lib/core/vault";
import { getHermes } from "@/lib/core/hermes";
import type { RedisLike } from "@/lib/core/store/types";
import { getArticle } from "@/lib/articles";
import {
  gradeOutcome,
  identifyConcept,
  prerequisiteChain,
  conceptLabel,
  detectPrerequisiteGap,
  type GapResult,
  type Outcome,
} from "./plan";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";

export interface FeedbackInput {
  uid?: string;
  articleId?: string;
  topic?: string;
  lessonTitle?: string;
  scorePct: number;
  feedbackText?: string;
}

export interface FeedbackResult {
  outcome: Outcome;
  gap: GapResult | null;
}

async function groundingFor(input: FeedbackInput): Promise<{ text: string; topic: string }> {
  let text = input.topic || "";
  let topic = input.topic || "";
  if (input.articleId) {
    const a = await getArticle(input.articleId);
    if (a) {
      text = [a.title, a.summary, a.text].filter(Boolean).join("\n\n");
      topic = topic || a.topic || a.title;
    }
  }
  return { text: text || topic, topic: topic || "this topic" };
}

/** LLM fallback: pick which prerequisite (from the known chain) the learner lacks. */
async function llmGap(topicText: string, feedbackText: string): Promise<GapResult | null> {
  const concept = identifyConcept(topicText);
  if (!concept) return null;
  const chain = prerequisiteChain(concept);
  if (!chain.length) return null;

  const llm = getLLM();
  if (!llm) return null;

  const labels = chain.map(conceptLabel);
  const prompt =
    `A learner studied "${conceptLabel(concept)}". Its prerequisites are: ${labels.join(", ")}.\n` +
    `Their feedback on why they couldn't answer the questions: "${feedbackText}".\n` +
    `Which ONE prerequisite from the list are they missing? Reply with ONLY the exact label, or "none".`;
  try {
    const ans = (await llm.complete(prompt, { maxTokens: 30, temperature: 0 })).trim().toLowerCase();
    const hit = chain.find((id) => ans.includes(conceptLabel(id).toLowerCase()));
    if (!hit) return null;
    const blockerLabel = conceptLabel(hit);
    const topicLabel = conceptLabel(concept);
    return {
      blocker: hit,
      blockerLabel,
      topic: concept,
      topicLabel,
      suggestion:
        `Since ${topicLabel} builds on ${blockerLabel}, want to learn ${blockerLabel} basics first? ` +
        `I'll prioritise ${blockerLabel}, then we'll come back to ${topicLabel}.`,
    };
  } catch {
    return null;
  }
}

/** Analyse end-of-lesson feedback: grade, detect gap, persist, record knowledge. */
export async function analyzeFeedback(input: FeedbackInput): Promise<FeedbackResult> {
  const uid = input.uid || "demo";
  const outcome = gradeOutcome(input.scorePct);
  const { text, topic } = await groundingFor(input);

  // Detect the blocking prerequisite (deterministic first, LLM only if needed).
  let gap: GapResult | null = null;
  if (outcome !== "mastered" && input.feedbackText) {
    gap = detectPrerequisiteGap(text, input.feedbackText) || (await llmGap(text, input.feedbackText));
  }

  // Persist the raw feedback (best effort).
  try {
    const r = getRedis();
    await r.lpush(
      `feedback:${uid}:${input.articleId || slug(topic)}`,
      JSON.stringify({
        topic,
        scorePct: input.scorePct,
        outcome,
        feedbackText: input.feedbackText || "",
        gap: gap ? { blocker: gap.blocker, topic: gap.topic } : null,
        at: Date.now(),
      })
    );
  } catch {
    /* best effort */
  }

  await writeKnowledgeNote(uid, topic, input, outcome, gap);

  // Record a Hermes episode so the self-improving loop sees learning outcomes.
  try {
    const hermes = getHermes(getRedis() as unknown as RedisLike);
    await hermes.recordEpisode({
      uid,
      task: "lesson-feedback",
      topic,
      strategyVersion: 0,
      input: `score=${input.scorePct}% outcome=${outcome}`,
      output: gap ? `gap detected: ${gap.blockerLabel}` : "no prerequisite gap",
      metrics: { scorePct: input.scorePct, gap: gap ? 1 : 0 },
    });
  } catch {
    /* best effort */
  }

  return { outcome, gap };
}

/** Append to the user's durable knowledge note (browsable in Obsidian). */
async function writeKnowledgeNote(
  uid: string,
  topic: string,
  input: FeedbackInput,
  outcome: Outcome,
  gap: GapResult | null
): Promise<void> {
  try {
    const vault = getVault();
    const path = `knowledge/${slug(uid)}/${slug(topic)}`;
    const when = new Date().toISOString();
    const lines = [
      `## ${when}`,
      `- **Lesson:** ${input.lessonTitle || topic}`,
      `- **Score:** ${input.scorePct}% (${outcome})`,
    ];
    if (input.feedbackText) lines.push(`- **Said:** ${input.feedbackText}`);
    if (gap) {
      lines.push(
        `- **Gap:** does not yet know **${gap.blockerLabel}** (prerequisite of ${gap.topicLabel}); ${gap.topicLabel} deferred.`
      );
    } else if (outcome === "mastered") {
      lines.push(`- **Mastered:** ${topic}.`);
    }
    await vault.append(path, lines.join("\n") + "\n");
  } catch {
    /* vault unavailable — non-fatal */
  }
}

/** Record that the user accepted learning a prerequisite first (reprioritise). */
export async function recordPrereqAcceptance(
  uid: string,
  gap: { blocker: string; blockerLabel: string; topicLabel: string; suggestion: string }
): Promise<void> {
  const r = getRedis();
  try {
    await r.lpush(
      `prereq:${uid}:pending`,
      JSON.stringify({
        concept: gap.blocker,
        label: gap.blockerLabel,
        blockedTopicLabel: gap.topicLabel,
        at: Date.now(),
      })
    );
  } catch {
    /* best effort */
  }
  // Reward signal: the suggestion was accepted → Hermes tunes future suggestions.
  try {
    await getHermes(r as unknown as RedisLike).recordOutcome(uid, gap.suggestion, true);
  } catch {
    /* best effort */
  }
}

/** Pending prerequisites the learner accepted (for the Learn map). De-duped by concept. */
export async function listPendingPrereqs(
  uid: string
): Promise<Array<{ concept: string; label: string; blockedTopicLabel: string; at: number }>> {
  try {
    const raw = await getRedis().lrange(`prereq:${uid}:pending`, 0, 49);
    const seen = new Set<string>();
    const out: Array<{ concept: string; label: string; blockedTopicLabel: string; at: number }> = [];
    for (const r of raw) {
      try {
        const p = JSON.parse(r);
        if (p.concept && !seen.has(p.concept)) {
          seen.add(p.concept);
          out.push(p);
        }
      } catch {
        /* skip */
      }
    }
    return out;
  } catch {
    return [];
  }
}
