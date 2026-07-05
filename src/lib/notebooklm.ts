// Back-compat shim. The summariser is now a pluggable provider under
// `@/lib/core/summarize` (LLM / NotebookLM-CLI / local extractive, selected by
// env). New code should import `summarize` from there. These re-exports keep
// existing imports working.

import { summarize as coreSummarize } from "@/lib/core/summarize";

export { localSummarize } from "@/lib/core/summarize/local";
export { summarize } from "@/lib/core/summarize";

/**
 * Deprecated: returns the NotebookLM/LLM summary string, or null to let callers
 * apply their own fallback. Prefer `summarize()` which handles the full chain.
 */
export async function notebooklmSummarize(
  text: string,
  title?: string,
  url?: string
): Promise<string | null> {
  const { summary, via } = await coreSummarize({ text, title, url });
  return via === "local" ? null : summary;
}
