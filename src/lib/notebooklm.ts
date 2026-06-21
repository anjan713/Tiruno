// Pluggable article summariser.
//
// NotebookLM has NO official API. `notebooklm-mcp-cli`
// (https://github.com/anjan713/notebooklm-mcp-cli) drives Google NotebookLM via
// CLI / MCP server and requires an authenticated Google session, so it belongs in
// the standalone worker — not in a stateless Next.js route. When that worker is up
// and NOTEBOOKLM_ENABLED=1, wire the call inside `notebooklmSummarize` below.
//
// Until then we use a fast built-in extractive summary so the
// "summarise -> explain with Deepgram" loop works end to end today.

export async function notebooklmSummarize(
  _text: string,
  _title?: string,
  _url?: string
): Promise<string | null> {
  if (process.env.NOTEBOOKLM_ENABLED !== "1") return null;
  // TODO (worker): via notebooklm-mcp-cli —
  //   1. add the article as a source (prefer `add-url <_url>` so NotebookLM parses
  //      the live link itself; fall back to uploading `_text`),
  //   2. poll until the source finishes processing,
  //   3. request a summary / audio-overview and return the text here.
  // Requires an authenticated Google session, so it runs in the worker, not this route.
  return null;
}

/** Lightweight extractive "what is this about" summary. */
export function localSummarize(text: string, title?: string): string {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "There isn't enough text to summarise yet.";
  const isCode = (s: string) =>
    /[{}]|=>|;\s|\bfunction\s*\(|addEventListener|querySelector|document\.|window\.|@click|x-data|=\s*\(/.test(s);
  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !isCode(s));
  const lead = (sentences.slice(0, 3).join(" ") || clean).slice(0, 600);
  const prefix = title ? `Here's what "${title}" is about. ` : "Here's what this is about. ";
  return (prefix + lead).slice(0, 700);
}
