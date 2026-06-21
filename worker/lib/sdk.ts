import { query } from "@anthropic-ai/claude-agent-sdk";
import { REPO_ROOT } from "./env";

export interface RunResult {
  text: string;
  ok: boolean;
  error?: string;
}

export interface RunOptions {
  prompt: string;
  systemPrompt?: string;
  /** Agent Skills to enable (must exist under .claude/skills). */
  skills?: string[];
  maxTurns?: number;
  /** Friendly progress callback for streaming to the UI. */
  onStep?: (step: string) => void;
}

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
 * Run a one-shot Claude Agent SDK session (subscription auth via Claude Code CLI).
 * Skills under `.claude/skills` are auto-discovered because settingSources includes 'project'.
 */
export async function runSkillAgent(opts: RunOptions): Promise<RunResult> {
  const { prompt, systemPrompt, skills = ["last30days"], maxTurns = 40, onStep } = opts;
  let finalText = "";
  let ok = false;
  let error: string | undefined;

  try {
    const q = query({
      prompt,
      options: {
        cwd: REPO_ROOT,
        settingSources: ["project"],
        skills,
        allowedTools: ["Bash", "Read", "Write", "WebSearch", "Glob", "Grep"],
        permissionMode: "bypassPermissions",
        ...(process.env.CLAUDE_MODEL ? { model: process.env.CLAUDE_MODEL } : {}),
        ...(systemPrompt ? { systemPrompt } : {}),
        env: process.env as Record<string, string>,
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
