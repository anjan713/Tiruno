import { fetchWithRetry } from "../http";
import type { LLMCompleteOptions, LLMProvider } from "./types";

/**
 * Ollama adapter — fully local, free, zero-API-key inference. Run `ollama serve`
 * and pull a model (e.g. `ollama pull llama3.1`). This is the recommended default
 * for self-hosting / open-source users who don't want to pay for a hosted API.
 */
export class OllamaLLM implements LLMProvider {
  readonly name = "ollama";
  readonly model: string;
  private readonly host: string;

  constructor(model?: string, host?: string) {
    this.model = model || process.env.OLLAMA_MODEL || "llama3.1";
    this.host = (host || process.env.OLLAMA_HOST || "http://localhost:11434").replace(/\/$/, "");
  }

  async complete(prompt: string, opts: LLMCompleteOptions = {}): Promise<string> {
    const res = await fetchWithRetry(
      `${this.host}/api/chat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: opts.model || this.model,
          stream: false,
          ...(opts.json ? { format: "json" } : {}),
          options: { temperature: opts.temperature ?? 0.3, num_predict: opts.maxTokens ?? 1024 },
          messages: [
            ...(opts.system ? [{ role: "system", content: opts.system }] : []),
            { role: "user", content: prompt },
          ],
        }),
      },
      { timeoutMs: opts.timeoutMs ?? 120000, attempts: 2 }
    );

    const json = await res.json();
    return String(json?.message?.content ?? "").trim();
  }
}
