import { getLLM } from "../llm";
import type { AgentRunner, AgentRunOptions, AgentRunResult } from "./types";

/**
 * LLM-backed agent runner: a single completion through the active LLMProvider,
 * with no external tools. This is the portable default used for classify/author
 * tasks (orchestrator routing, lesson authoring, path planning) that don't need
 * web/shell access. Tool-dependent work should use a ResearchProvider instead.
 */
export class LLMAgentRunner implements AgentRunner {
  readonly name = "llm";
  readonly supportsTools = false;

  async run(opts: AgentRunOptions): Promise<AgentRunResult> {
    const llm = getLLM();
    if (!llm) {
      return { text: "", ok: false, error: "no_llm_configured" };
    }
    try {
      opts.onStep?.("Thinking…");
      const text = await llm.complete(opts.prompt, {
        system: opts.system,
        maxTokens: 2048,
        temperature: 0.4,
      });
      return { text, ok: !!text, error: text ? undefined : "empty_response" };
    } catch (e) {
      return { text: "", ok: false, error: (e as Error).message };
    }
  }
}
