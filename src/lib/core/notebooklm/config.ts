// NotebookLM configuration — resolved entirely from the environment so the
// client works against the real `notebooklm-mcp-cli` (binary `nlm`,
// https://github.com/jacob-bd/notebooklm-mcp-cli) and can run in a hermetic
// MOCK mode for dev/tests.
//
// The real CLI uses `nlm <group> <verb>` commands (e.g. `nlm source add`,
// `nlm audio create`, `nlm studio status --json`, `nlm download audio`). Each
// command is a token array so individual commands can be overridden if a CLI
// build differs.

import type { NotebookKind } from "./types";

export interface NotebookLMConfig {
  /** Master switch. When false, the client and agents no-op gracefully. */
  enabled: boolean;
  /** Hermetic in-memory simulator — no CLI/Google session needed (dev/tests). */
  mock: boolean;
  /** Base command, split into argv (default ["nlm"]). */
  baseCmd: string[];
  /** Verb → command token array (override individually if your CLI differs). */
  sub: Record<NotebookVerb, string[]>;
  /** Notebook kind → NotebookLM notebook id (or an `nlm alias`). */
  notebooks: Record<NotebookKind, string>;
  /** Optional `nlm --profile` to target a specific authenticated session. */
  profile?: string;
  timeoutMs: number;
  /** Audio overview is async: poll `studio status` every audioPollMs… */
  audioPollMs: number;
  /** …up to audioTimeoutMs before giving up. */
  audioTimeoutMs: number;
  /** `nlm audio create --format` (deep_dive|brief|critique|debate). */
  audioFormat: string;
  /** `nlm audio create --length` (short|default|long). */
  audioLength: string;
  retentionDays: number;
  /** Per-notebook source cap (NotebookLM caps ~50) → drives rotation. */
  sourceCap: number;
  /** Where converted .md/.pdf files + downloaded podcasts are written. */
  dataDir: string;
}

export type NotebookVerb =
  | "addSource"
  | "listSources"
  | "deleteSource"
  | "audioCreate"
  | "studioStatus"
  | "downloadAudio";

const DEFAULT_SUB: Record<NotebookVerb, string[]> = {
  addSource: ["source", "add"],
  listSources: ["source", "list"],
  deleteSource: ["source", "delete"],
  audioCreate: ["audio", "create"],
  studioStatus: ["studio", "status"],
  downloadAudio: ["download", "audio"],
};

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export function notebookLMConfig(): NotebookLMConfig {
  const mock = env("NOTEBOOKLM_MOCK") === "1";
  const enabled =
    mock ||
    env("NOTEBOOKLM_ENABLED") === "1" ||
    (env("SUMMARIZER") || "").toLowerCase() === "notebooklm";

  // The real ingestion CLI binary is `nlm`. NOTE: distinct from the summarizer's
  // NOTEBOOKLM_CMD (which embeds a "summarize" verb). The ingestion client
  // appends its own command tokens, so it needs a *base* command only.
  const baseCmd = (env("NOTEBOOKLM_CLI") || "nlm").split(/\s+/);

  const sub: Record<NotebookVerb, string[]> = { ...DEFAULT_SUB };
  (Object.keys(DEFAULT_SUB) as NotebookVerb[]).forEach((verb) => {
    const override = env(`NOTEBOOKLM_SUB_${verb.toUpperCase()}`);
    if (override) sub[verb] = override.split(/\s+/);
  });

  return {
    enabled,
    mock,
    baseCmd,
    sub,
    notebooks: {
      courses: env("NOTEBOOKLM_NOTEBOOK_COURSES") || "courses",
      articles: env("NOTEBOOKLM_NOTEBOOK_ARTICLES") || "articles",
    },
    profile: env("NOTEBOOKLM_PROFILE"),
    timeoutMs: Number(env("NOTEBOOKLM_TIMEOUT_MS") ?? 120000),
    audioPollMs: Number(env("NOTEBOOKLM_AUDIO_POLL_MS") ?? 5000),
    audioTimeoutMs: Number(env("NOTEBOOKLM_AUDIO_TIMEOUT_MS") ?? 600000),
    audioFormat: env("NOTEBOOKLM_AUDIO_FORMAT") || "deep_dive",
    audioLength: env("NOTEBOOKLM_AUDIO_LENGTH") || "default",
    retentionDays: Number(env("NOTEBOOKLM_RETENTION_DAYS") ?? 7),
    sourceCap: Number(env("NOTEBOOKLM_SOURCE_CAP") ?? 50),
    dataDir: env("NOTEBOOKLM_DATA_DIR") || "data/materials",
  };
}

export function notebookLMEnabled(): boolean {
  return notebookLMConfig().enabled;
}
