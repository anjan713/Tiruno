// Provider-agnostic Q&A used during article narration. Reasoning runs through
// the active LLMProvider (Anthropic/OpenAI/Ollama/…); speech-in (STT) and
// speech-out (TTS) are handled separately by the active VoiceProvider.

import { getLLM, llmProviderName } from "@/lib/core/llm";

export interface AnswerOpts {
  context?: string;
  title?: string;
}

export interface AnswerResult {
  answer: string;
  /** Which backend answered: provider name, or "local" for the built-in heuristic. */
  via: string;
}

const SYSTEM =
  "You are Tiru, a warm and encouraging tutor inside a learning app. " +
  "Answer the learner's spoken question in 2-3 short sentences, grounded in the provided article context. " +
  "If the answer isn't in the context, say so briefly, then give your best concise explanation. " +
  "Write plainly and conversationally because your answer will be read aloud — no markdown, lists, headings, or code blocks.";

/**
 * Answer a learner's question, grounded in the article context. Returns null
 * when no LLM provider is configured or the call fails, so callers can fall back
 * to a built-in answer (keeping the app usable with zero keys).
 */
export async function answerQuestion(question: string, opts: AnswerOpts = {}): Promise<string | null> {
  const llm = getLLM();
  const q = question.trim();
  if (!llm || !q) return null;

  const prompt =
    `Article${opts.title ? ` titled "${opts.title}"` : ""}:\n` +
    `${(opts.context || "").slice(0, 6000) || "(no extra context provided)"}\n\n` +
    `Learner's question: ${q}`;

  try {
    const text = await llm.complete(prompt, { system: SYSTEM, maxTokens: 300, temperature: 0.3, timeoutMs: 15000 });
    return text || null;
  } catch {
    return null;
  }
}

/** Built-in heuristic answer used when no LLM is configured or it's unreachable. */
export function localAnswer(question: string): string {
  const q = question.toLowerCase();
  if (q.includes("vector") || q.includes("embedding"))
    return "Vectors capture meaning, so we retrieve text that's relevant even when the wording differs — that's why semantic search beats keyword matching here.";
  if (q.includes("hallucinat") || q.includes("trust") || q.includes("wrong"))
    return "Grounding the model in retrieved sources keeps it honest — it answers from real material and cites it instead of guessing.";
  return "Great question! Retrieval keeps the answer grounded in your sources, so Tiru teaches from real material and cites it — not guesses.";
}

/**
 * Answer with provider info, always returning a usable answer: the active LLM when
 * available, otherwise the built-in heuristic. Lets callers (e.g. /api/ask) stay thin.
 */
export async function answer(question: string, opts: AnswerOpts = {}): Promise<AnswerResult> {
  const text = await answerQuestion(question, opts);
  if (text) return { answer: text, via: llmProviderName() };
  return { answer: localAnswer(question), via: "local" };
}
