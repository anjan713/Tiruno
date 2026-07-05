// Summarizer registry + convenience helper.
//
// Selection (override with SUMMARIZER=notebooklm|llm|local):
//   NOTEBOOKLM_ENABLED=1 -> try NotebookLM first
//   LLM provider present -> LLM summarizer (clear, grounded)  [smart default]
//   always                -> local extractive fallback
//
// summarize() walks the chain and returns the first non-empty result, so a clear
// summary is produced whenever any backend is available.

import { getLLM } from "../llm";
import { LLMSummarizer } from "./llm";
import { LocalSummarizer, localSummarize } from "./local";
import { NotebookLMSummarizer } from "./notebooklm";
import type { SummarizeInput, Summarizer } from "./types";

export type { SummarizeInput, Summarizer } from "./types";
export { LLMSummarizer } from "./llm";
export { LocalSummarizer, localSummarize } from "./local";
export { NotebookLMSummarizer } from "./notebooklm";

export function summarizerChain(): Summarizer[] {
  const override = (process.env.SUMMARIZER || "").toLowerCase();
  if (override === "local") return [new LocalSummarizer()];

  const chain: Summarizer[] = [];
  if (override === "notebooklm" || process.env.NOTEBOOKLM_ENABLED === "1") {
    chain.push(new NotebookLMSummarizer());
  }
  if (getLLM()) chain.push(new LLMSummarizer());
  chain.push(new LocalSummarizer());
  return chain;
}

export interface SummarizeResult {
  summary: string;
  /** Which backend produced the summary: "notebooklm" | "llm" | "local". */
  via: string;
}

/** Summarise text using the best available backend, with graceful fallback. */
export async function summarize(input: SummarizeInput): Promise<SummarizeResult> {
  for (const s of summarizerChain()) {
    try {
      const out = await s.summarize(input);
      if (out && out.trim()) return { summary: out.trim(), via: s.name };
    } catch {
      /* try next backend */
    }
  }
  return { summary: localSummarize(input.text, input.title), via: "local" };
}
