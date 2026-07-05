// Low-level runner for the real `notebooklm-mcp-cli` (binary `nlm`). Spawns the
// configured command (e.g. `nlm source add …`), captures stdout, and exposes
// helpers to parse both `--json` output (objects/arrays) and the CLI's
// human-readable Rich text (e.g. "Source ID: <id>"). Every call is insulated: on
// any failure it resolves to a structured error rather than throwing, so
// callers/agents can degrade gracefully.

import { execFile } from "node:child_process";
import type { NotebookLMConfig, NotebookVerb } from "./config";

export interface CliResult {
  ok: boolean;
  /** ANSI-stripped stdout (trimmed). */
  raw: string;
  /** Parsed JSON (object or array) when stdout contains a JSON document. */
  json?: unknown;
  error?: string;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

/** Strip ANSI color codes (Rich emits them when a TTY is detected). */
export function stripAnsi(s: string): string {
  return (s || "").replace(ANSI, "");
}

/** Best-effort JSON extraction: the CLI prints a JSON object or array with `--json`. */
export function parseJson(raw: string): unknown {
  if (!raw) return undefined;
  // Try a bare parse first, then fall back to slicing the outermost {…}/[…].
  const candidates: [number, number][] = [];
  const objA = raw.indexOf("{");
  const objB = raw.lastIndexOf("}");
  const arrA = raw.indexOf("[");
  const arrB = raw.lastIndexOf("]");
  if (arrA !== -1 && arrB > arrA) candidates.push([arrA, arrB]);
  if (objA !== -1 && objB > objA) candidates.push([objA, objB]);
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  for (const [a, b] of candidates) {
    try {
      return JSON.parse(raw.slice(a, b + 1));
    } catch {
      /* try next */
    }
  }
  return undefined;
}

/** Extract the first capture group of `re` from the CLI's text output. */
export function extractField(raw: string, re: RegExp): string | undefined {
  const m = raw.match(re);
  return m && m[1] ? m[1].trim() : undefined;
}

/**
 * Run a NotebookLM CLI verb. `cfg.sub[verb]` provides the command tokens
 * (e.g. ["source","add"]); `args` are appended. Adds `--profile` when set.
 */
export function runCli(
  cfg: NotebookLMConfig,
  verb: NotebookVerb,
  args: string[],
  opts: { stdin?: string; timeoutMs?: number } = {}
): Promise<CliResult> {
  const [bin, ...baseArgs] = cfg.baseCmd;
  const profileArgs = cfg.profile ? ["--profile", cfg.profile] : [];
  const fullArgs = [...baseArgs, ...cfg.sub[verb], ...args, ...profileArgs];

  return new Promise<CliResult>((resolve) => {
    let settled = false;
    const done = (r: CliResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };

    try {
      const child = execFile(
        bin,
        fullArgs,
        { timeout: opts.timeoutMs ?? cfg.timeoutMs, maxBuffer: 32 * 1024 * 1024 },
        (err, stdout, stderr) => {
          const raw = stripAnsi(String(stdout || "")).trim();
          const json = parseJson(raw);
          if (err) {
            const detail = stripAnsi(String(stderr || "")).trim() || err.message;
            if (process.env.NODE_ENV !== "production") {
              console.warn(`[notebooklm:${verb}]`, detail);
            }
            done({ ok: false, raw, json, error: detail });
            return;
          }
          done({ ok: true, raw, json });
        }
      );
      if (opts.stdin !== undefined && child.stdin) {
        child.stdin.end(opts.stdin.slice(0, 200000));
      }
    } catch (e) {
      done({ ok: false, raw: "", error: (e as Error).message });
    }
  });
}
