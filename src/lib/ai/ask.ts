"use client";

export interface AskTiruInput {
  question: string;
  articleId?: string;
  context?: string;
  title?: string;
}

export interface AskTiruResult {
  answer: string;
  via: "claude" | "local" | "";
}

/**
 * Ask Tiru for an answer to a learner's question. Hits /api/ask, which uses
 * Claude when ANTHROPIC_API_KEY is set and otherwise returns a built-in answer.
 * Returns an empty answer only when the request itself fails (network/server),
 * so callers can apply their own fallback.
 */
export async function askTiru(input: AskTiruInput): Promise<AskTiruResult> {
  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (res.ok) {
      const json = await res.json();
      if (json?.answer) return { answer: String(json.answer), via: json.via ?? "" };
    }
  } catch {
    /* fall through to empty result */
  }
  return { answer: "", via: "" };
}
