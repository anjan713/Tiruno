// Client helpers for the NotebookLM ingestion surface (state, podcast, engagement).
// All are best-effort and degrade silently so they're safe to call from any screen.

export interface NotebookAsset {
  kind: string;
  refId?: string;
  url?: string;
  at: number;
}

export interface NotebookState {
  articleId: string;
  notebook: string;
  status: string;
  active: boolean;
  assets: NotebookAsset[];
  score: number;
  addedAt: number;
  expiresAt: number;
  sourceId?: string;
}

export interface PodcastMeta {
  url: string;
  status: string;
  at: number;
}

/** Fetch an article's NotebookLM lifecycle state + generated assets. */
export async function getNotebookState(
  articleId: string
): Promise<{ state: NotebookState; podcast: PodcastMeta | null } | null> {
  try {
    const res = await fetch(`/api/ingest?articleId=${encodeURIComponent(articleId)}`);
    if (!res.ok) return null;
    return (await res.json()) as { state: NotebookState; podcast: PodcastMeta | null };
  } catch {
    return null;
  }
}

/** Streaming URL for an article's NotebookLM audio overview (podcast). */
export function podcastStreamUrl(articleId: string): string {
  return `/api/podcast/${encodeURIComponent(articleId)}`;
}

/**
 * Record engagement with an ingested article (view/listen/quiz score), which
 * extends its NotebookLM retention window. Best-effort.
 */
export async function recordEngagement(articleId: string, score?: number): Promise<void> {
  try {
    await fetch(`/api/notebook/engagement`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articleId, ...(score != null ? { score } : {}) }),
    });
  } catch {
    /* best-effort */
  }
}
