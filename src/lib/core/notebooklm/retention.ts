// Per-article retention state for the Articles notebook (docs/notebooklm-ingestion.md).
//
// NotebookLM caps sources per notebook (~50), so each ingested article is tracked
// with an expiry. Engagement extends the window; a cleanup job removes sources
// whose window has passed (or the soonest-expiring ones when over the cap).
//
// Redis keys:
//   notebook:articles:{articleId}  -> JSON ArticleNotebookState
//   notebook:articles:expiry       -> ZSET member=articleId score=expiresAt(ms)
//   notebook:sources:{notebookId}  -> SET of sourceIds (cap counting)

import type Redis from "ioredis";
import type { ArticleNotebookState, AssetRef, NotebookKind, SourceKind } from "./types";

const STATE_KEY = (articleId: string) => `notebook:articles:${articleId}`;
const EXPIRY_INDEX = "notebook:articles:expiry";
const SOURCE_SET = (notebookId: string) => `notebook:sources:${notebookId}`;

const DAY_MS = 24 * 60 * 60 * 1000;
const STATE_TTL_S = 60 * 60 * 24 * 60; // keep state 60d for audit even after removal

export async function getArticleState(redis: Redis, articleId: string): Promise<ArticleNotebookState | null> {
  const raw = await redis.get(STATE_KEY(articleId));
  return raw ? (JSON.parse(raw) as ArticleNotebookState) : null;
}

async function save(redis: Redis, state: ArticleNotebookState): Promise<ArticleNotebookState> {
  state.updatedAt = Date.now();
  await redis.set(STATE_KEY(state.articleId), JSON.stringify(state), "EX", STATE_TTL_S);
  if (state.active) {
    await redis.zadd(EXPIRY_INDEX, state.expiresAt, state.articleId);
  } else {
    await redis.zrem(EXPIRY_INDEX, state.articleId);
  }
  return state;
}

/** First contact: an article has been picked for ingestion but no source added yet. */
export async function recordDiscovered(
  redis: Redis,
  articleId: string,
  notebook: NotebookKind = "articles"
): Promise<ArticleNotebookState> {
  const existing = await getArticleState(redis, articleId);
  if (existing) return existing;
  const now = Date.now();
  return save(redis, {
    articleId,
    notebook,
    status: "discovered",
    active: false,
    assets: [],
    score: 0,
    addedAt: now,
    expiresAt: now,
    updatedAt: now,
  });
}

/** A source has been added to the notebook for this article. Starts the window. */
export async function recordIngested(
  redis: Redis,
  args: {
    articleId: string;
    notebook: NotebookKind;
    sourceId: string;
    sourceKind: SourceKind;
    url?: string;
    notebookId: string;
    retentionDays: number;
  }
): Promise<ArticleNotebookState> {
  const now = Date.now();
  const prev = await getArticleState(redis, args.articleId);
  const state: ArticleNotebookState = {
    articleId: args.articleId,
    notebook: args.notebook,
    sourceId: args.sourceId,
    sourceKind: args.sourceKind,
    url: args.url,
    status: "ingested",
    active: true,
    assets: prev?.assets ?? [],
    score: prev?.score ?? 0,
    addedAt: prev?.addedAt ?? now,
    expiresAt: now + args.retentionDays * DAY_MS,
    updatedAt: now,
  };
  await redis.sadd(SOURCE_SET(args.notebookId), args.sourceId);
  return save(redis, state);
}

/** Record generated assets (podcast/lesson/mcq) and advance to "assets". */
export async function recordAssets(
  redis: Redis,
  articleId: string,
  assets: AssetRef[]
): Promise<ArticleNotebookState | null> {
  const state = await getArticleState(redis, articleId);
  if (!state) return null;
  state.assets = [...state.assets, ...assets];
  state.status = "assets";
  return save(redis, state);
}

/** Engagement (a view/listen/quiz score) extends retention by another window. */
export async function touchEngagement(
  redis: Redis,
  articleId: string,
  score: number,
  retentionDays: number
): Promise<ArticleNotebookState | null> {
  const state = await getArticleState(redis, articleId);
  if (!state || !state.active) return state ?? null;
  state.score = Math.max(state.score, Math.round(score));
  state.status = "engaged";
  state.expiresAt = Date.now() + retentionDays * DAY_MS;
  return save(redis, state);
}

/** Article ids whose retention window has passed (and are still active). */
export async function dueForRemoval(redis: Redis, now = Date.now()): Promise<string[]> {
  return redis.zrangebyscore(EXPIRY_INDEX, 0, now);
}

/** All currently-active article ids, soonest-expiring first. */
export async function activeArticleIds(redis: Redis): Promise<string[]> {
  return redis.zrange(EXPIRY_INDEX, 0, -1);
}

/** Mark an article removed from the notebook (idempotent). */
export async function markRemoved(redis: Redis, articleId: string, notebookId?: string): Promise<void> {
  const state = await getArticleState(redis, articleId);
  await redis.zrem(EXPIRY_INDEX, articleId);
  if (!state) return;
  if (notebookId && state.sourceId) await redis.srem(SOURCE_SET(notebookId), state.sourceId);
  state.active = false;
  state.status = "removed";
  await save(redis, state);
}

/** Number of sources currently tracked in a notebook (for cap enforcement). */
export async function sourceCount(redis: Redis, notebookId: string): Promise<number> {
  return redis.scard(SOURCE_SET(notebookId));
}
