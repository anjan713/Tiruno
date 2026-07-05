// Integration availability — a read-only snapshot of which capabilities are live,
// running in a mock/simulator, or off. Surfaced to users so they know whether
// they're in full or degraded mode. Pure status: NO side effects.

import { notebookLMConfig } from "../notebooklm/config";
import { llmProviderName } from "../llm";
import { embeddingProvider } from "@/lib/rag/embeddings";
import { getVault } from "../vault";

export type IntegrationState = "live" | "mock" | "off";

export interface IntegrationStatus {
  id: string;
  label: string;
  state: IntegrationState;
  detail: string;
}

export interface IntegrationsReport {
  integrations: IntegrationStatus[];
  /** Hermes skills authored/updated in the last 30 days (information gathering). */
  skillsLast30Days: number;
  totalSkills: number;
  generatedAt: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getIntegrationsStatus(): Promise<IntegrationsReport> {
  const integrations: IntegrationStatus[] = [];

  // LLM (reasoning / lesson authoring) — Claude subscription preferred.
  const llm = llmProviderName();
  integrations.push({
    id: "llm",
    label: "Claude / Reasoning",
    state: llm === "none" ? "off" : "live",
    detail:
      llm === "claude-agent"
        ? "Claude subscription (Agent SDK)"
        : llm === "anthropic"
          ? "Anthropic API"
          : llm === "openai"
            ? "OpenAI"
            : llm === "ollama"
              ? "Ollama (local)"
              : "No LLM — built-in heuristics",
  });

  // NotebookLM — heavy lesson generation + audio overview.
  const nb = notebookLMConfig();
  integrations.push({
    id: "notebooklm",
    label: "NotebookLM",
    state: !nb.enabled ? "off" : nb.mock ? "mock" : "live",
    detail: !nb.enabled
      ? "Disabled"
      : nb.mock
        ? "Hermetic simulator (NOTEBOOKLM_MOCK=1)"
        : `Live via \`${nb.baseCmd.join(" ")}\` · ${nb.audioFormat} audio`,
  });

  // Gmail newsletter ingestion.
  const gmailMock = process.env.GMAIL_MOCK === "1";
  const gmailLive = process.env.GMAIL_ENABLED === "1" && !!process.env.GMAIL_CMD;
  integrations.push({
    id: "gmail",
    label: "Gmail ingestion",
    state: gmailMock ? "mock" : gmailLive ? "live" : "off",
    detail: gmailMock ? "Canned newsletters" : gmailLive ? "Live via GMAIL_CMD" : "Disabled",
  });

  // Embeddings / vector search (RAG grounding).
  const embed = embeddingProvider();
  integrations.push({
    id: "embeddings",
    label: "Vector search",
    state: embed === "local" ? "mock" : "live",
    detail:
      embed === "ollama"
        ? `Ollama (${process.env.OLLAMA_EMBED_MODEL || "mxbai-embed-large"})`
        : embed === "openai"
          ? "OpenAI"
          : "Local hashing (no key)",
  });

  // Obsidian vault — always available (filesystem-backed memory).
  integrations.push({
    id: "vault",
    label: "Obsidian memory",
    state: "live",
    detail: process.env.TIRUNO_VAULT_DIR || "./vault",
  });

  // Hermes self-learning: how many skills were learned in the last 30 days.
  let skillsLast30Days = 0;
  let totalSkills = 0;
  try {
    const vault = getVault();
    const paths = await vault.list("skills");
    totalSkills = paths.length;
    const cutoff = Date.now() - 30 * DAY_MS;
    for (const p of paths) {
      const note = await vault.read(p);
      const at = Number(note?.frontmatter?.at ?? note?.updatedAt ?? 0);
      if (at >= cutoff) skillsLast30Days += 1;
    }
  } catch {
    /* vault empty or unreadable — report zeros */
  }

  return { integrations, skillsLast30Days, totalSkills, generatedAt: Date.now() };
}
