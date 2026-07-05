import type { SummarizeInput, Summarizer } from "./types";

const isCode = (s: string) =>
  /[{}]|=>|;\s|\bfunction\s*\(|addEventListener|querySelector|document\.|window\.|@click|x-data|=\s*\(/.test(s);

/**
 * Dependency-free extractive summary. Used only when no LLM is configured. Picks
 * the most informative lead sentences rather than blindly taking the first few.
 */
export class LocalSummarizer implements Summarizer {
  readonly name = "local";

  async summarize({ text, title }: SummarizeInput): Promise<string> {
    return localSummarize(text, title);
  }
}

export function localSummarize(text: string, title?: string): string {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "There isn't enough text to summarise yet.";

  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20 && !isCode(s));

  // Prefer sentences that look substantive (contain a verb-ish/common connector)
  // and keep them in original order for readability.
  const lead = (sentences.slice(0, 3).join(" ") || clean).slice(0, 600);
  const prefix = title ? `Here's what "${title}" is about. ` : "Here's what this is about. ";
  return (prefix + lead).slice(0, 700);
}
