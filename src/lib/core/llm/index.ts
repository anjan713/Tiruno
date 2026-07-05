// LLM provider registry — env-driven selection, mirroring embeddingProvider().
//
// Priority (override with LLM_PROVIDER=claude-agent|anthropic|openai|ollama):
//   ANTHROPIC_API_KEY -> anthropic
//   OPENAI_API_KEY    -> openai
//   OLLAMA_HOST set    -> ollama
//   (none)             -> null  (callers fall back to built-in heuristics)
//
// `claude-agent` is opt-in only (set LLM_PROVIDER=claude-agent): it routes every
// completion through the Claude Agent SDK using your Claude **subscription**
// (CLI login), so the whole app runs with no API key.

import { AnthropicLLM } from "./anthropic";
import { ClaudeAgentLLM } from "./claudeAgent";
import { OpenAILLM } from "./openai";
import { OllamaLLM } from "./ollama";
import { NoLLMConfiguredError, type LLMProvider } from "./types";

export type { LLMProvider, LLMCompleteOptions, LLMMessage } from "./types";
export { NoLLMConfiguredError } from "./types";

export type LLMProviderName = "claude-agent" | "anthropic" | "openai" | "ollama" | "none";

/** Which provider will be used given the current environment. */
export function llmProviderName(): LLMProviderName {
  const override = (process.env.LLM_PROVIDER || "").toLowerCase();
  if (
    override === "claude-agent" ||
    override === "anthropic" ||
    override === "openai" ||
    override === "ollama"
  ) {
    return override;
  }
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.OLLAMA_HOST) return "ollama";
  return "none";
}

let cached: { key: string; provider: LLMProvider | null } | undefined;

/**
 * Get the active LLM provider, or `null` when none is configured so callers can
 * apply their own built-in fallback (keeping the app usable with zero keys).
 */
export function getLLM(): LLMProvider | null {
  const name = llmProviderName();
  if (cached && cached.key === name) return cached.provider;

  let provider: LLMProvider | null = null;
  switch (name) {
    case "claude-agent":
      // Force subscription auth (strip any ANTHROPIC_API_KEY before calling the SDK) so
      // Claude billing always goes through the CLI subscription, never the paid API —
      // even if a key is present in the environment.
      provider = new ClaudeAgentLLM(undefined, true);
      break;
    case "anthropic":
      provider = new AnthropicLLM(process.env.ANTHROPIC_API_KEY!);
      break;
    case "openai":
      provider = new OpenAILLM(process.env.OPENAI_API_KEY!);
      break;
    case "ollama":
      provider = new OllamaLLM();
      break;
    default:
      provider = null;
  }
  cached = { key: name, provider };
  return provider;
}

/** Like getLLM() but throws NoLLMConfiguredError when none is available. */
export function requireLLM(): LLMProvider {
  const llm = getLLM();
  if (!llm) throw new NoLLMConfiguredError();
  return llm;
}

/**
 * A provider that runs on the Claude **subscription** (Agent SDK + CLI login),
 * independent of the app's default provider. Use this for features that must bill the
 * subscription rather than the API. Returns null if it can't be constructed.
 */
export function getSubscriptionLLM(): LLMProvider | null {
  try {
    return new ClaudeAgentLLM(undefined, true);
  } catch {
    return null;
  }
}

/**
 * Best-effort: extract a single JSON object/array from an LLM response that may
 * include prose or ```json fences. Returns `fallback` when nothing parses.
 */
export function parseJsonFromText<T>(text: string, fallback: T): T {
  if (!text) return fallback;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const objStart = candidate.indexOf("{");
  const arrStart = candidate.indexOf("[");
  const start =
    objStart === -1 ? arrStart : arrStart === -1 ? objStart : Math.min(objStart, arrStart);
  const open = candidate[start];
  const end = open === "[" ? candidate.lastIndexOf("]") : candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return fallback;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    return fallback;
  }
}
