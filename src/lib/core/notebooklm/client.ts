// NotebookLM client — a typed wrapper over every `notebooklm-mcp-cli` operation
// the ingestion pipeline needs (docs/notebooklm-ingestion.md):
//   add URL source · upload file source · generate audio overview ·
//   activate/deactivate source · remove source · list sources.
//
// In MOCK mode (NOTEBOOKLM_MOCK=1) it runs a deterministic in-memory simulator
// so the whole pipeline can be exercised end-to-end without a CLI or Google
// session. Every method degrades gracefully: failures throw a NotebookLMError
// that agents catch and translate into a "removed/error" state.

import { createHash } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { notebookLMConfig, type NotebookLMConfig } from "./config";
import { runCli, extractField } from "./cli";
import type { AudioOverview, NotebookKind, SourceInfo } from "./types";

export class NotebookLMError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotebookLMError";
  }
}

function shortId(seed: string): string {
  return createHash("sha1").update(seed).digest("hex").slice(0, 12);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface StudioArtifact {
  type?: string;
  status?: string;
  artifact_id?: string;
}

/** Normalize `nlm studio status --json` output (array, or `{ artifacts: [...] }`). */
function normalizeArtifacts(json: unknown): StudioArtifact[] {
  const arr = Array.isArray(json)
    ? json
    : Array.isArray((json as { artifacts?: unknown[] } | null)?.artifacts)
    ? (json as { artifacts: unknown[] }).artifacts
    : [];
  return arr
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
    .map((a) => ({
      type: typeof a.type === "string" ? a.type : undefined,
      status: typeof a.status === "string" ? a.status : undefined,
      artifact_id: typeof a.artifact_id === "string" ? a.artifact_id : undefined,
    }));
}

// ---------------------------------------------------------------------------
// Mock simulator (process-local). Mirrors the real CLI's observable behavior.
// ---------------------------------------------------------------------------
type MockNotebook = Map<string, SourceInfo>;
const mockStore = new Map<string, MockNotebook>();

function mockNotebook(id: string): MockNotebook {
  let nb = mockStore.get(id);
  if (!nb) {
    nb = new Map();
    mockStore.set(id, nb);
  }
  return nb;
}

/** Reset the in-memory mock (tests). */
export function __resetMockStore(): void {
  mockStore.clear();
}

export class NotebookLMClient {
  readonly cfg: NotebookLMConfig;

  constructor(cfg?: NotebookLMConfig) {
    this.cfg = cfg ?? notebookLMConfig();
  }

  private notebookId(nb: NotebookKind): string {
    return this.cfg.notebooks[nb];
  }

  private ensureEnabled(): void {
    if (!this.cfg.enabled) {
      throw new NotebookLMError("NotebookLM is disabled (set NOTEBOOKLM_ENABLED=1 or NOTEBOOKLM_MOCK=1)");
    }
  }

  async addUrlSource(nb: NotebookKind, url: string, title?: string): Promise<SourceInfo> {
    this.ensureEnabled();
    const id = this.notebookId(nb);
    if (this.cfg.mock) {
      const src: SourceInfo = { id: `src-${shortId(id + url)}`, title, url, kind: "url", active: true };
      mockNotebook(id).set(src.id, src);
      return src;
    }
    // `nlm source add <nb> --url <url>` (YouTube uses --youtube). Prints
    // "Source ID: <id>" as Rich text (no --json on `source add`).
    const flag = /(?:youtube\.com|youtu\.be)/i.test(url) ? "--youtube" : "--url";
    const res = await runCli(this.cfg, "addSource", [id, flag, url]);
    const sourceId = extractField(res.raw, /Source ID:\s*(\S+)/i);
    if (!res.ok || !sourceId) throw new NotebookLMError(res.error || "addUrlSource failed");
    return { id: sourceId, title, url, kind: "url", active: true };
  }

  async uploadFileSource(nb: NotebookKind, filePath: string, title?: string): Promise<SourceInfo> {
    this.ensureEnabled();
    const id = this.notebookId(nb);
    if (this.cfg.mock) {
      const src: SourceInfo = { id: `src-${shortId(id + filePath)}`, title, kind: "file", active: true };
      mockNotebook(id).set(src.id, src);
      return src;
    }
    // `nlm source add <nb> --file <path> --wait` (block until processed).
    const res = await runCli(this.cfg, "addSource", [id, "--file", filePath, "--wait"], {
      timeoutMs: this.cfg.audioTimeoutMs,
    });
    const sourceId = extractField(res.raw, /Source ID:\s*(\S+)/i);
    if (!res.ok || !sourceId) throw new NotebookLMError(res.error || "uploadFileSource failed");
    return { id: sourceId, title, kind: "file", active: true };
  }

  /**
   * Generate the audio overview (podcast). NotebookLM generation is asynchronous:
   * `nlm audio create` kicks it off, then we poll `nlm studio status` until the
   * artifact is completed and `nlm download audio` saves it to a local file
   * (served by /api/podcast/[articleId]).
   */
  async generateAudioOverview(nb: NotebookKind, sourceIds?: string[]): Promise<AudioOverview> {
    this.ensureEnabled();
    const id = this.notebookId(nb);
    if (this.cfg.mock) {
      const seed = (sourceIds ?? []).join(",") || id;
      return { audioUrl: `mock://audio/${id}/${shortId(seed)}.wav`, status: "ready" };
    }

    const createArgs = [id, "--confirm", "--format", this.cfg.audioFormat, "--length", this.cfg.audioLength];
    if (sourceIds && sourceIds.length) createArgs.push("--source-ids", sourceIds.join(","));
    const created = await runCli(this.cfg, "audioCreate", createArgs);
    if (!created.ok) throw new NotebookLMError(created.error || "audio create failed");
    const artifactId = extractField(created.raw, /Artifact ID:\s*(\S+)/i);

    // Poll until the audio artifact reaches a terminal state.
    const deadline = Date.now() + this.cfg.audioTimeoutMs;
    let ready = false;
    while (Date.now() < deadline) {
      await sleep(this.cfg.audioPollMs);
      const status = await runCli(this.cfg, "studioStatus", [id, "--json", "--full"]);
      const artifacts = normalizeArtifacts(status.json);
      const audio = artifacts.filter((a) => a.type === "audio");
      const target = artifactId
        ? artifacts.find((a) => a.artifact_id === artifactId)
        : audio[audio.length - 1];
      if (target?.status === "completed") {
        ready = true;
        break;
      }
      if (target?.status === "failed") throw new NotebookLMError("audio generation failed");
    }
    if (!ready) throw new NotebookLMError("audio generation timed out");

    const outPath = `${this.cfg.dataDir}/podcasts/${id}-${artifactId ?? "latest"}.m4a`;
    await mkdir(dirname(outPath), { recursive: true });
    const dlArgs = [id, "--output", outPath, ...(artifactId ? ["--id", artifactId] : [])];
    const dl = await runCli(this.cfg, "downloadAudio", dlArgs, { timeoutMs: this.cfg.audioTimeoutMs });
    if (!dl.ok) throw new NotebookLMError(dl.error || "audio download failed");
    try {
      await stat(outPath);
    } catch {
      throw new NotebookLMError("audio file missing after download");
    }
    return { audioUrl: outPath, status: "ready" };
  }

  async activateSource(nb: NotebookKind, sourceId: string): Promise<void> {
    await this.setActive(nb, sourceId, true);
  }

  async deactivateSource(nb: NotebookKind, sourceId: string): Promise<void> {
    await this.setActive(nb, sourceId, false);
  }

  private async setActive(nb: NotebookKind, sourceId: string, active: boolean): Promise<void> {
    this.ensureEnabled();
    const id = this.notebookId(nb);
    if (this.cfg.mock) {
      const src = mockNotebook(id).get(sourceId);
      if (src) src.active = active;
      return;
    }
    // The real `nlm` CLI exposes no source activate/deactivate verb — NotebookLM
    // source selection isn't scriptable. Treat as a no-op: retention only needs
    // add/remove/list, and rotation removes sources outright.
    void id;
    void sourceId;
    void active;
  }

  async removeSource(_nb: NotebookKind, sourceId: string): Promise<void> {
    this.ensureEnabled();
    if (this.cfg.mock) {
      mockNotebook(this.notebookId(_nb)).delete(sourceId);
      return;
    }
    // `nlm source delete <source-id> --confirm` (source IDs are global; no --notebook).
    const res = await runCli(this.cfg, "deleteSource", [sourceId, "--confirm"]);
    if (!res.ok) throw new NotebookLMError(res.error || "removeSource failed");
  }

  async listSources(nb: NotebookKind): Promise<SourceInfo[]> {
    this.ensureEnabled();
    const id = this.notebookId(nb);
    if (this.cfg.mock) {
      return [...mockNotebook(id).values()].map((s) => ({ ...s }));
    }
    // `nlm source list <nb> --json` → array of { id, title, source_type_name, ... }.
    const res = await runCli(this.cfg, "listSources", [id, "--json"]);
    if (!res.ok) throw new NotebookLMError(res.error || "listSources failed");
    const sources = Array.isArray(res.json) ? (res.json as unknown[]) : [];
    return sources
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
      .map((s): SourceInfo => {
        const typeName = String(s.source_type_name ?? s.type ?? "").toLowerCase();
        return {
          id: String(s.id ?? s.source_id ?? ""),
          title: s.title ? String(s.title) : undefined,
          active: undefined,
          kind: /url|youtube|web|link/.test(typeName) ? "url" : "file",
          url: s.url ? String(s.url) : undefined,
        };
      })
      .filter((s) => s.id);
  }
}
