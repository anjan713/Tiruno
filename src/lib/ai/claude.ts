// Server-side Claude (Anthropic) call used to answer learner questions during
// article Q&A. Deepgram still does speech-in (STT) and speech-out (TTS); Claude
// is the reasoning step in between. Uses raw fetch so we don't add an SDK dep.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

export interface AskOpts {
  context?: string;
  title?: string;
}

interface AnthropicTextBlock {
  type?: string;
  text?: string;
}

/**
 * Ask Claude to answer a learner's question, grounded in the article context.
 * Returns null when ANTHROPIC_API_KEY is missing or the call fails, so callers
 * can fall back to a built-in answer.
 */
export async function askClaude(question: string, opts: AskOpts = {}): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  const q = question.trim();
  if (!key || !q) return null;

  const system =
    "You are Tiru, a warm and encouraging tutor inside a learning app. " +
    "Answer the learner's spoken question in 2-3 short sentences, grounded in the provided article context. " +
    "If the answer isn't in the context, say so briefly, then give your best concise explanation. " +
    "Write plainly and conversationally because your answer will be read aloud — no markdown, lists, headings, or code blocks.";

  const userContent =
    `Article${opts.title ? ` titled "${opts.title}"` : ""}:\n` +
    `${(opts.context || "").slice(0, 6000) || "(no extra context provided)"}\n\n` +
    `Learner's question: ${q}`;

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        temperature: 0.3,
        system,
        messages: [{ role: "user", content: userContent }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const blocks: AnthropicTextBlock[] = Array.isArray(json?.content) ? json.content : [];
    const text = blocks
      .filter((b) => b?.type === "text")
      .map((b) => b.text || "")
      .join(" ")
      .trim();
    return text || null;
  } catch {
    return null;
  }
}
