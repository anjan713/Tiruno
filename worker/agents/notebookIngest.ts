import type Redis from "ioredis";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeBus } from "../lib/bus";
import {
  fetchArticle,
  genId,
  getArticle,
  hostOf,
  saveArticle,
  indexArticleVector,
  type StoredArticle,
} from "../../src/lib/articles";
import {
  NotebookLMClient,
  notebookLMConfig,
  retention,
  type AssetRef,
  type ArticleNotebookState,
  type NotebookKind,
} from "../../src/lib/core/notebooklm";
import { recordSignal } from "../loops/l1";
import { runGenerateLesson } from "./lesson";

export interface IngestArticleJob {
  uid: string;
  jobId: string;
  /** Ingest an existing stored article… */
  articleId?: string;
  /** …or create one on the fly from a discovered source / email. */
  url?: string;
  title?: string;
  topic?: string;
  text?: string;
  /** Force the file-upload route (emails always upload; never added as a URL). */
  email?: boolean;
  /** Re-ingest even if this article already has an active source (dedup override). */
  force?: boolean;
  notebook?: NotebookKind;
}

const podcastKey = (articleId: string) => `podcast:${articleId}`;
/** Maps a source URL to the articleId we already created for it (URL-level dedup). */
const urlKey = (url: string) => `notebook:url:${createHash("sha1").update(url).digest("hex").slice(0, 16)}`;

/** Resolve (or create + persist) the StoredArticle this job refers to. */
async function resolveArticle(redis: Redis, job: IngestArticleJob): Promise<StoredArticle | null> {
  if (job.articleId) {
    const existing = await getArticle(job.articleId);
    if (existing) return existing;
  }
  // URL-level dedup: reuse the article we already created for this URL.
  if (job.url && !job.articleId) {
    const mapped = await redis.get(urlKey(job.url));
    if (mapped) {
      const existing = await getArticle(mapped);
      if (existing) return existing;
    }
  }
  if (!job.url && !job.text) return null;

  let title = job.title?.trim() || "";
  let text = (job.text ?? "").trim();
  let source = job.url ? hostOf(job.url) : "email";
  if (job.url && !text) {
    try {
      const fetched = await fetchArticle(job.url);
      text = fetched.text;
      title = title || fetched.title;
      source = fetched.source;
    } catch {
      /* keep whatever we have */
    }
  }

  const article: StoredArticle = {
    id: job.articleId || genId(),
    url: job.url,
    title: title || job.url || "Untitled",
    source,
    topic: job.topic?.trim() || "General",
    text,
    summary: "",
    status: "ready",
    ready: true,
    kind: "bookmark",
    addedAt: Date.now(),
  };
  await saveArticle(article);
  if (article.url) await redis.set(urlKey(article.url), article.id, "EX", 60 * 60 * 24 * 90);
  return article;
}

/**
 * Free notebook slots under the per-notebook cap. Evicts the **lowest-engagement**
 * sources first (tiebreak: soonest-expiring), so material the user actually
 * engaged with survives rotation.
 */
async function ensureCapacity(
  redis: Redis,
  client: NotebookLMClient,
  notebook: NotebookKind
): Promise<void> {
  const cfg = client.cfg;
  const notebookId = cfg.notebooks[notebook];
  let count = await retention.sourceCount(redis, notebookId);
  if (count < cfg.sourceCap) return;

  const candidates: ArticleNotebookState[] = [];
  for (const id of await retention.activeArticleIds(redis)) {
    const st = await retention.getArticleState(redis, id);
    if (st && st.active && st.notebook === notebook && st.sourceId) candidates.push(st);
  }
  // Lowest score first; among equal scores, the soonest to expire goes first.
  candidates.sort((a, b) => a.score - b.score || a.expiresAt - b.expiresAt);

  for (const st of candidates) {
    if (count < cfg.sourceCap) break;
    try {
      await client.removeSource(notebook, st.sourceId!);
    } catch {
      /* still drop our tracking below */
    }
    await retention.markRemoved(redis, st.articleId, notebookId);
    count--;
  }
}

/**
 * NotebookLM ingestion agent — runs the per-article state machine:
 *   discovered → ingested (source added) → assets (podcast + lesson/MCQ).
 * Clean public URLs become URL sources; emails/paywalled pages are written to
 * disk and uploaded as file sources. No-ops gracefully when NotebookLM is off.
 */
export async function runIngestArticle(redis: Redis, job: IngestArticleJob): Promise<void> {
  const bus = makeBus(redis);
  const cfg = notebookLMConfig();
  const notebook: NotebookKind = job.notebook ?? "articles";

  if (!cfg.enabled) {
    await bus.publish(job.uid, {
      jobId: job.jobId,
      type: "done",
      status: "ready",
      result: { skipped: true, reason: "NotebookLM disabled" },
    });
    return;
  }

  try {
    await bus.publish(job.uid, { jobId: job.jobId, type: "progress", status: "researching", step: "Preparing source…" });

    const article = await resolveArticle(redis, job);
    if (!article) {
      await bus.publish(job.uid, { jobId: job.jobId, type: "error", status: "error", error: "No article to ingest" });
      return;
    }

    const prior = await retention.recordDiscovered(redis, article.id, notebook);
    // Dedup: if this article already has a live source, don't re-add it.
    if (!job.force && prior.active && prior.sourceId && prior.status !== "removed") {
      await bus.publish(job.uid, {
        jobId: job.jobId,
        type: "done",
        status: "ready",
        result: { deduped: true, articleId: article.id, notebook, sourceId: prior.sourceId, status: prior.status },
      });
      return;
    }
    const client = new NotebookLMClient(cfg);
    await ensureCapacity(redis, client, notebook);

    // Route: emails / pages without a clean URL → file upload; else URL source.
    const useFile = job.email === true || !article.url;
    let sourceId: string;
    if (useFile) {
      await mkdir(cfg.dataDir, { recursive: true });
      const filePath = join(cfg.dataDir, `${article.id}.md`);
      const md = `# ${article.title}\n\n_Source: ${article.source}_\n\n${article.text}\n`;
      await writeFile(filePath, md, "utf8");
      await bus.publish(job.uid, { jobId: job.jobId, type: "progress", step: "Uploading file source…" });
      sourceId = (await client.uploadFileSource(notebook, filePath, article.title)).id;
    } else {
      await bus.publish(job.uid, { jobId: job.jobId, type: "progress", step: "Adding URL source…" });
      sourceId = (await client.addUrlSource(notebook, article.url!, article.title)).id;
    }

    await retention.recordIngested(redis, {
      articleId: article.id,
      notebook,
      sourceId,
      sourceKind: useFile ? "file" : "url",
      url: article.url,
      notebookId: cfg.notebooks[notebook],
      retentionDays: cfg.retentionDays,
    });

    // ---- Assets (best-effort; a failure in one doesn't fail the job) ----
    const assets: AssetRef[] = [];

    try {
      await bus.publish(job.uid, { jobId: job.jobId, type: "progress", step: "Generating podcast…" });
      const audio = await client.generateAudioOverview(notebook, [sourceId]);
      await redis.set(
        podcastKey(article.id),
        JSON.stringify({ url: audio.audioUrl, status: audio.status, at: Date.now() }),
        "EX",
        60 * 60 * 24 * 30
      );
      assets.push({ kind: "podcast", url: audio.audioUrl, at: Date.now() });
    } catch (e) {
      console.warn("[notebookIngest] podcast failed:", (e as Error).message);
    }

    try {
      await bus.publish(job.uid, { jobId: job.jobId, type: "progress", step: "Writing lesson + MCQs…" });
      const lessonJobId = `${job.jobId}-lesson`;
      await runGenerateLesson(redis, { uid: job.uid, jobId: lessonJobId, topic: article.topic, articleId: article.id });
      const lessonId = `gen-${lessonJobId}`;
      assets.push({ kind: "lesson", refId: lessonId, at: Date.now() });
      assets.push({ kind: "mcq", refId: lessonId, at: Date.now() });
    } catch (e) {
      console.warn("[notebookIngest] lesson failed:", (e as Error).message);
    }

    await retention.recordAssets(redis, article.id, assets);
    await indexArticleVector(article);
    await recordSignal(redis, job.uid, { kind: "explore", topic: article.topic });

    await bus.publish(job.uid, {
      jobId: job.jobId,
      type: "done",
      status: "ready",
      result: {
        articleId: article.id,
        notebook,
        sourceId,
        sourceKind: useFile ? "file" : "url",
        assets,
      },
    });
  } catch (e) {
    await bus.publish(job.uid, { jobId: job.jobId, type: "error", status: "error", error: (e as Error).message });
  }
}
