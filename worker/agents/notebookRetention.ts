import type Redis from "ioredis";
import { makeBus } from "../lib/bus";
import {
  NotebookLMClient,
  notebookLMConfig,
  retention,
  type ArticleNotebookState,
  type NotebookKind,
} from "../../src/lib/core/notebooklm";

export interface NotebookCleanupJob {
  uid?: string;
  jobId?: string;
}

const NOTEBOOK_KINDS: NotebookKind[] = ["articles", "courses"];

/** Evict lowest-engagement (tiebreak soonest-expiry) sources over the cap. */
async function evictOverflow(redis: Redis, client: NotebookLMClient, notebook: NotebookKind): Promise<number> {
  const cfg = client.cfg;
  const notebookId = cfg.notebooks[notebook];
  let count = await retention.sourceCount(redis, notebookId);
  if (count <= cfg.sourceCap) return 0;

  const candidates: ArticleNotebookState[] = [];
  for (const id of await retention.activeArticleIds(redis)) {
    const st = await retention.getArticleState(redis, id);
    if (st && st.active && st.notebook === notebook && st.sourceId) candidates.push(st);
  }
  candidates.sort((a, b) => a.score - b.score || a.expiresAt - b.expiresAt);

  let evicted = 0;
  for (const st of candidates) {
    if (count <= cfg.sourceCap) break;
    try {
      await client.removeSource(notebook, st.sourceId!);
    } catch (e) {
      console.warn("[notebookCleanup] overflow remove failed:", (e as Error).message);
    }
    await retention.markRemoved(redis, st.articleId, notebookId);
    count--;
    evicted++;
  }
  return evicted;
}

export interface NotebookEngagementJob {
  uid?: string;
  jobId?: string;
  articleId: string;
  /** 0..100 engagement/quiz score. Defaults to a mid "viewed" weight. */
  score?: number;
}

/**
 * Rotation/cleanup job: remove sources whose retention window has passed from the
 * Articles notebook, advancing each to "removed". Keeps the notebook under
 * NotebookLM's per-notebook source cap. Safe to run on a timer.
 */
export async function runNotebookCleanup(redis: Redis, job: NotebookCleanupJob = {}): Promise<{ removed: number }> {
  const cfg = notebookLMConfig();
  if (!cfg.enabled) {
    if (job.uid && job.jobId) {
      await makeBus(redis).publish(job.uid, { jobId: job.jobId, type: "done", status: "ready", result: { removed: 0, skipped: true } });
    }
    return { removed: 0 };
  }

  const client = new NotebookLMClient(cfg);
  const due = await retention.dueForRemoval(redis, Date.now());
  let removed = 0;

  for (const articleId of due) {
    const st = await retention.getArticleState(redis, articleId);
    if (st?.sourceId) {
      try {
        await client.removeSource(st.notebook, st.sourceId);
      } catch (e) {
        console.warn("[notebookCleanup] remove failed:", (e as Error).message);
      }
    }
    const notebookId = st ? cfg.notebooks[st.notebook] : undefined;
    await retention.markRemoved(redis, articleId, notebookId);
    removed++;
  }

  // Then keep each notebook under its source cap (lowest-engagement evicted first).
  let evicted = 0;
  for (const notebook of NOTEBOOK_KINDS) {
    evicted += await evictOverflow(redis, client, notebook);
  }
  removed += evicted;

  if (job.uid && job.jobId) {
    await makeBus(redis).publish(job.uid, { jobId: job.jobId, type: "done", status: "ready", result: { removed, evicted } });
  }
  return { removed };
}

/**
 * Engagement signal: a view/listen/good quiz score extends an article's retention
 * window (so engaging material survives the next rotation).
 */
export async function runRecordEngagement(redis: Redis, job: NotebookEngagementJob): Promise<void> {
  const cfg = notebookLMConfig();
  const state = await retention.touchEngagement(redis, job.articleId, job.score ?? 50, cfg.retentionDays);
  if (job.uid && job.jobId) {
    await makeBus(redis).publish(job.uid, {
      jobId: job.jobId,
      type: "done",
      status: "ready",
      result: { articleId: job.articleId, status: state?.status ?? "unknown", expiresAt: state?.expiresAt },
    });
  }
}
