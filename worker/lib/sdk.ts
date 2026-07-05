// Thin compatibility shim over the provider-agnostic agent runner in
// `src/lib/core/agent`. The Claude Agent SDK is now an OPTIONAL, pluggable
// adapter selected at runtime — this file no longer imports it directly, so the
// worker runs against any configured LLM provider. Existing agents keep calling
// `runSkillAgent(...)` unchanged.

import { getAgentRunner } from "../../src/lib/core/agent";

export interface RunResult {
  text: string;
  ok: boolean;
  error?: string;
}

export interface RunOptions {
  prompt: string;
  systemPrompt?: string;
  /** Capabilities/skills to enable (only the tool-capable runner uses these). */
  skills?: string[];
  maxTurns?: number;
  /** Friendly progress callback for streaming to the UI. */
  onStep?: (step: string) => void;
}

/**
 * Run a one-shot agent session through the active runner. When `skills` are
 * requested, we ask for a tool-capable runner (Claude Agent SDK if installed);
 * otherwise any LLM provider can serve the request.
 */
export async function runSkillAgent(opts: RunOptions): Promise<RunResult> {
  const { prompt, systemPrompt, skills, maxTurns = 40, onStep } = opts;
  const needsTools = Array.isArray(skills) && skills.length > 0;
  const runner = await getAgentRunner(needsTools);
  return runner.run({ prompt, system: systemPrompt, skills, maxTurns, onStep });
}
