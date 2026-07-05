import { fetchWithRetry } from "../http";
import type { LLMCompleteOptions, LLMProvider } from "./types";

const URL = "https://api.anthropic.com/v1/messages";

interface AnthropicTextBlock {
  type?: string;
  text?: string;
}

/** Anthropic (Claude) Messages API adapter. Uses raw fetch — no SDK dependency. */
export class AnthropicLLM implements LLMProvider {
  readonly name = "anthropic";
  readonly model: string;
  private readonly apiKey: string;

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.model = model || process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
  }

  async complete(prompt: string, opts: LLMCompleteOptions = {}): Promise<string> {
    const system =
      (opts.system ?? "") +
      (opts.json ? "\nRespond with ONLY a single valid JSON object — no prose, no markdown fences." : "");

    const res = await fetchWithRetry(
      URL,
      {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: opts.model || this.model,
          max_tokens: opts.maxTokens ?? 1024,
          temperature: opts.temperature ?? 0.3,
          ...(system.trim() ? { system: system.trim() } : {}),
          messages: [{ role: "user", content: prompt }],
        }),
      },
      { timeoutMs: opts.timeoutMs ?? 30000 }
    );

    const json = await res.json();
    const blocks: AnthropicTextBlock[] = Array.isArray(json?.content) ? json.content : [];
    return blocks
      .filter((b) => b?.type === "text")
      .map((b) => b.text || "")
      .join("")
      .trim();
  }
}
