// Agent runner contract — a tool-using / skill-using agent loop.
//
// Some tasks (research over the live web) need an agent that can call tools and
// run multiple turns. Others (classify, author JSON) only need a single LLM
// completion. Both are expressed through this one interface so callers never
// depend on a specific agent SDK. Select via getAgentRunner().

export interface AgentRunOptions {
  prompt: string;
  system?: string;
  /** Named capabilities/skills to enable (only some runners support these). */
  skills?: string[];
  maxTurns?: number;
  /** Streamed, human-friendly progress lines for the UI. */
  onStep?: (step: string) => void;
}

export interface AgentRunResult {
  text: string;
  ok: boolean;
  error?: string;
}

export interface AgentRunner {
  readonly name: string;
  /** True if this runner can use external tools / skills (web, shell, files). */
  readonly supportsTools: boolean;
  run(opts: AgentRunOptions): Promise<AgentRunResult>;
}
