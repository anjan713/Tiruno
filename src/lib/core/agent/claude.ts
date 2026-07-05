import type { AgentRunner, AgentRunOptions, AgentRunResult } from "./types";

/** Turn a long assistant text block into a short progress line. */
function textStep(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > 140 ? clean.slice(0, 137) + "…" : clean;
}

/** Turn a tool_use block into a friendly progress line. */
function toolStep(block: { name?: string; input?: Record<string, unknown> }): string {
  const name = block.name ?? "tool";
  if (name === "Bash") {
    const cmd = String(block.input?.command ?? "");
    if (/last30days/.test(cmd)) return "Searching Reddit, X, YouTube, HN, GitHub & the web…";
    if (/python|uv /.test(cmd)) return "Running research scripts…";
    return "Working…";
  }
  if (name === "WebSearch") return "Searching the web…";
  if (name === "Read" || name === "Glob" || name === "Grep") return "Reading results…";
  if (name === "Write") return "Saving findings…";
  return `Using ${name}…`;
}

/**
 * Env for the SDK with API keys removed so it always authenticates via the Claude
 * **subscription** (CLI login). The Agent SDK bills the paid API whenever
 * ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN is present, so we drop them here.
 */
function subscriptionEnv(): Record<string, string> {
  const env = { ...(process.env as Record<string, string>) };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

/**
 * Claude Agent SDK runner (subscription auth via Claude Code CLI). The SDK is
 * imported dynamically so it is an OPTIONAL dependency: if it isn't installed,
 * getAgentRunner() simply won't select this adapter. Skills under `.claude/skills`
 * are auto-discovered because settingSources includes 'project'.
 */
export class ClaudeAgentRunner implements AgentRunner {
  readonly name = "claude-agent";
  readonly supportsTools = true;

  static async isAvailable(): Promise<boolean> {
    try {
      await import("@anthropic-ai/claude-agent-sdk");
      return true;
    } catch {
      return false;
    }
  }

  async run(opts: AgentRunOptions): Promise<AgentRunResult> {
    const { prompt, system, skills = [], maxTurns = 40, onStep } = opts;
    let finalText = "";
    let ok = false;
    let error: string | undefined;

    try {
      const { query } = await import("@anthropic-ai/claude-agent-sdk");
      const q = query({
        prompt,
        options: {
          cwd: process.env.AGENT_CWD || process.cwd(),
          settingSources: ["project"],
          skills,
          allowedTools: ["Bash", "Read", "Write", "WebSearch", "Glob", "Grep"],
          permissionMode: "bypassPermissions",
          ...(process.env.CLAUDE_MODEL ? { model: process.env.CLAUDE_MODEL } : {}),
          ...(system ? { systemPrompt: system } : {}),
          env: subscriptionEnv(),
          maxTurns,
        },
      });

      for await (const msg of q) {
        if (msg.type === "assistant") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const content: any[] = (msg as any).message?.content ?? [];
          for (const block of content) {
            if (block?.type === "text" && block.text) {
              const s = textStep(block.text);
              if (s) onStep?.(s);
            } else if (block?.type === "tool_use") {
              onStep?.(toolStep(block));
            }
          }
        } else if (msg.type === "result") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const m = msg as any;
          ok = m.subtype === "success";
          finalText = typeof m.result === "string" ? m.result : "";
          if (!ok) error = m.subtype || "agent_error";
        }
      }
    } catch (e) {
      ok = false;
      error = (e as Error)?.message ?? String(e);
    }

    return { text: finalText, ok, error };
  }
}
