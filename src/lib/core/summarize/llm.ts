import { getLLM } from "../llm";
import type { SummarizeInput, Summarizer } from "./types";

/**
 * LLM-based summarizer — the smart default. Produces a clear, read-aloud-friendly
 * summary grounded in the source text, using whichever LLM provider is active
 * (including your Claude subscription via LLM_PROVIDER=claude-agent).
 */
export class LLMSummarizer implements Summarizer {
  readonly name = "llm";

  async summarize({ text, title }: SummarizeInput): Promise<string> {
    const llm = getLLM();
    if (!llm) return "";

    const clean = (text || "").replace(/\s+/g, " ").trim();
    if (!clean) return "";

    const subject = title ? `the article titled "${title}"` : "the following text";
    const prompt =
      `Summarise ${subject} for a curious learner. Write 3 to 5 clear sentences in plain, ` +
      `spoken English — it will be read aloud. Lead with what it's about, then the key ` +
      `takeaways and why they matter. Do not use markdown, bullet points, headings, or ` +
      `lists. Ground every statement in the text; do not invent details.\n\n` +
      `---\n${clean.slice(0, 8000)}\n---`;

    const out = await llm.complete(prompt, {
      system: "You are a concise, accurate explainer. Output only the summary prose.",
      maxTokens: 400,
      temperature: 0.3,
    });
    return out.trim();
  }
}
