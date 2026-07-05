import type { LLMCompleteOptions, LLMProvider } from "./types";

/**
 * Claude Agent SDK adapter exposed as a plain LLMProvider. Unlike the Anthropic
 * Messages adapter (which needs ANTHROPIC_API_KEY / API billing), this routes
 * completions through `@anthropic-ai/claude-agent-sdk`, which authenticates via
 * your Claude Code CLI login — i.e. it runs on your Claude **subscription** with
 * no API key. Select it with LLM_PROVIDER=claude-agent.
 *
 * It runs a single, tool-less turn (maxTurns: 1, no skills/tools) so it behaves
 * like a normal text/JSON completion. The SDK is imported dynamically so it stays
 * an optional dependency. NOTE: if ANTHROPIC_API_KEY is set, the SDK bills the
 * API instead of the subscription — leave it unset to use the subscription.
 */
export class ClaudeAgentLLM implements LLMProvider {
  readonly name = "claude-agent";
  readonly model: string;

  /**
   * @param forceSubscription when true, ANTHROPIC_API_KEY is stripped from the env
   * handed to the SDK so it authenticates via the Claude CLI **subscription** (the SDK
   * otherwise bills the API whenever that key is present). Lets a single feature run on
   * the subscription regardless of the app's default provider — e.g. the Tiru chat.
   */
  constructor(model?: string, private readonly forceSubscription = false) {
    this.model = model || process.env.CLAUDE_MODEL || "claude-agent-subscription";
  }

  /** Env passed to the SDK; on the subscription path the API key is removed. */
  private agentEnv(): Record<string, string> {
    const env = { ...(process.env as Record<string, string>) };
    if (this.forceSubscription) {
      delete env.ANTHROPIC_API_KEY;
      delete env.ANTHROPIC_AUTH_TOKEN;
    }
    return env;
  }

  static async isAvailable(): Promise<boolean> {
    try {
      await import("@anthropic-ai/claude-agent-sdk");
      return true;
    } catch {
      return false;
    }
  }

  async complete(prompt: string, opts: LLMCompleteOptions = {}): Promise<string> {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const system =
      (opts.system ?? "") +
      (opts.json ? "\nRespond with ONLY a single valid JSON object — no prose, no markdown fences." : "");
    const modelOverride = opts.model || process.env.CLAUDE_MODEL;

    let acc = "";
    let result = "";

    const run = (async () => {
      const q = query({
        prompt,
        options: {
          cwd: process.env.AGENT_CWD || process.cwd(),
          settingSources: [],
          allowedTools: [],
          permissionMode: "bypassPermissions",
          ...(modelOverride ? { model: modelOverride } : {}),
          ...(system.trim() ? { systemPrompt: system.trim() } : {}),
          env: this.agentEnv(),
          maxTurns: 1,
        },
      });

      for await (const msg of q) {
        if (msg.type === "assistant") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const content: any[] = (msg as any).message?.content ?? [];
          for (const block of content) {
            if (block?.type === "text" && block.text) acc += block.text;
          }
        } else if (msg.type === "result") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const m = msg as any;
          if (typeof m.result === "string") result = m.result;
        }
      }
    })();

    // Soft timeout: return whatever we have if the SDK runs long.
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, opts.timeoutMs ?? 60000));
    await Promise.race([run, timeout]);

    return (result || acc).trim();
  }
}
