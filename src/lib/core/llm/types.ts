// LLM provider contract — the modular reasoning layer.
//
// Any provider (Anthropic, OpenAI, Ollama, …) implements this interface, so the
// rest of the app never imports a vendor SDK directly. Select the active provider
// from the environment via `getLLM()` (see ./index.ts), mirroring the embeddings
// layer's provider-detection pattern.

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMCompleteOptions {
  /** System prompt / persona for the turn. */
  system?: string;
  /** Upper bound on output tokens. */
  maxTokens?: number;
  /** 0..1 sampling temperature. */
  temperature?: number;
  /**
   * Ask the provider to return a single JSON object. Providers that support a
   * native JSON mode use it; others get a strong instruction appended.
   */
  json?: boolean;
  /** Optional per-call model override. */
  model?: string;
  /** Abort the request after this many ms (default 30s). */
  timeoutMs?: number;
}

export interface LLMProvider {
  /** Stable identifier, e.g. "anthropic" | "openai" | "ollama". */
  readonly name: string;
  /** The default model this provider will use. */
  readonly model: string;
  /** Run a single completion and return the assistant's text. */
  complete(prompt: string, opts?: LLMCompleteOptions): Promise<string>;
}

/** Thrown when no LLM provider is configured but one is required. */
export class NoLLMConfiguredError extends Error {
  constructor() {
    super(
      "No LLM provider configured. Use your Claude subscription (LLM_PROVIDER=claude-agent), " +
        "or set ANTHROPIC_API_KEY / OPENAI_API_KEY, or run Ollama (OLLAMA_HOST). See PROVIDERS.md."
    );
    this.name = "NoLLMConfiguredError";
  }
}
