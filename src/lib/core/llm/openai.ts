import { fetchWithRetry } from "../http";
import type { LLMCompleteOptions, LLMProvider } from "./types";

/**
 * OpenAI-compatible Chat Completions adapter. Works with OpenAI and any
 * compatible gateway (set OPENAI_BASE_URL), e.g. OpenRouter, Together, vLLM.
 */
export class OpenAILLM implements LLMProvider {
  readonly name = "openai";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, model?: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.model = model || process.env.OPENAI_MODEL || "gpt-4o-mini";
    this.baseUrl = (baseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  }

  async complete(prompt: string, opts: LLMCompleteOptions = {}): Promise<string> {
    const messages = [
      ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
      { role: "user" as const, content: prompt },
    ];

    const res = await fetchWithRetry(
      `${this.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: opts.model || this.model,
          max_tokens: opts.maxTokens ?? 1024,
          temperature: opts.temperature ?? 0.3,
          messages,
          ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        }),
      },
      { timeoutMs: opts.timeoutMs ?? 30000 }
    );

    const json = await res.json();
    return String(json?.choices?.[0]?.message?.content ?? "").trim();
  }
}
