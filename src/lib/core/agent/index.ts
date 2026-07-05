// Agent runner registry.
//
// AGENT_RUNNER=claude|llm forces a choice. By default we prefer the Claude Agent
// SDK when it's installed AND Anthropic is the active LLM (so skills/tools work),
// otherwise we fall back to the portable single-completion LLM runner.

import { ClaudeAgentRunner } from "./claude";
import { LLMAgentRunner } from "./llm";
import { llmProviderName } from "../llm";
import type { AgentRunner } from "./types";

export type { AgentRunner, AgentRunOptions, AgentRunResult } from "./types";
export { ClaudeAgentRunner } from "./claude";
export { LLMAgentRunner } from "./llm";

let cached: AgentRunner | undefined;

/**
 * Resolve the active agent runner. `needsTools` lets callers request a
 * tool-capable runner (returns the Claude runner only if it's actually
 * available; otherwise the LLM runner, which the caller should treat as
 * tool-less).
 */
export async function getAgentRunner(needsTools = false): Promise<AgentRunner> {
  const override = (process.env.AGENT_RUNNER || "").toLowerCase();
  if (override === "llm") return new LLMAgentRunner();
  if (override === "claude" && (await ClaudeAgentRunner.isAvailable())) return new ClaudeAgentRunner();

  if (cached && !needsTools) return cached;

  const name = llmProviderName();
  const preferClaude =
    (needsTools || name === "anthropic" || name === "claude-agent") &&
    (await ClaudeAgentRunner.isAvailable());
  const runner: AgentRunner = preferClaude ? new ClaudeAgentRunner() : new LLMAgentRunner();
  if (!needsTools) cached = runner;
  return runner;
}
