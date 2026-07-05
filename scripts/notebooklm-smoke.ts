// Hermetic end-to-end smoke for the NotebookLM pipeline (TS worker side).
//
// Runs the real ingest/engagement/cleanup agents against the in-memory store in
// NOTEBOOKLM_MOCK mode — no Redis, no Google session, no LLM. Verifies the full
// state machine: ingest (url + file routes) → assets → engagement → rotation.
//
// Run: NOTEBOOKLM_MOCK=1 REDIS_URL= REDIS_HOST= ANTHROPIC_API_KEY= OPENAI_API_KEY= \
//      OLLAMA_HOST= npx tsx scripts/notebooklm-smoke.ts

import { createStore } from "../src/lib/core/store";
import { runIngestArticle } from "../worker/agents/notebookIngest";
import { runNotebookCleanup, runRecordEngagement } from "../worker/agents/notebookRetention";
import { NotebookLMClient, notebookLMConfig, retention } from "../src/lib/core/notebooklm";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function main(): Promise<void> {
  const redis = createStore() as unknown as Parameters<typeof runIngestArticle>[0];
  const cfg = notebookLMConfig();
  assert(cfg.enabled && cfg.mock, "NotebookLM must be in mock+enabled mode");
  const client = new NotebookLMClient(cfg);

  // 1) URL-source ingest (text supplied so no network fetch).
  await runIngestArticle(redis, {
    uid: "smoke",
    jobId: "j1",
    articleId: "smoke-1",
    url: "https://example.com/x",
    title: "X",
    topic: "Testing",
    text: "Some grounded text about testing pipelines and retention.",
  });
  let st = await retention.getArticleState(redis, "smoke-1");
  assert(st && st.status === "assets", "url ingest reaches 'assets'");
  assert(st.sourceKind === "url" && !!st.sourceId, "url source recorded");
  assert(await redis.get("podcast:smoke-1"), "podcast asset stored");
  assert((await client.listSources("articles")).length === 1, "1 source in notebook");

  // 2) Email → file-upload route.
  await runIngestArticle(redis, {
    uid: "smoke",
    jobId: "j2",
    articleId: "smoke-2",
    title: "Newsletter",
    topic: "News",
    text: "Email body content here that is comfortably long enough to ingest.",
    email: true,
  });
  st = await retention.getArticleState(redis, "smoke-2");
  assert(st && st.sourceKind === "file", "email uses file source");
  assert((await client.listSources("articles")).length === 2, "2 sources now");

  // 3) Engagement extends retention + flips status to 'engaged'.
  await runRecordEngagement(redis, { articleId: "smoke-1", score: 95 });
  st = await retention.getArticleState(redis, "smoke-1");
  assert(st && st.status === "engaged" && st.score === 95, "engagement recorded");

  // 4) Dedup: re-ingesting an active article must not add a second source.
  await runIngestArticle(redis, {
    uid: "smoke",
    jobId: "j1b",
    articleId: "smoke-1",
    url: "https://example.com/x",
    title: "X",
    topic: "Testing",
    text: "Some grounded text about testing pipelines and retention.",
  });
  assert((await client.listSources("articles")).length === 2, "dedup: no duplicate source");

  // 5) Engagement-aware cap eviction: with cap=2, a new ingest evicts the
  //    lowest-engagement source (smoke-2, score 0) and keeps engaged smoke-1.
  process.env.NOTEBOOKLM_SOURCE_CAP = "2";
  await runIngestArticle(redis, {
    uid: "smoke",
    jobId: "j3",
    articleId: "smoke-3",
    url: "https://example.com/y",
    title: "Y",
    topic: "Testing",
    text: "A third grounded article with enough text to ingest.",
  });
  assert((await retention.getArticleState(redis, "smoke-2"))?.status === "removed", "lowest-engagement smoke-2 evicted");
  assert((await retention.getArticleState(redis, "smoke-1"))?.active === true, "engaged smoke-1 retained");
  assert((await retention.getArticleState(redis, "smoke-3"))?.active === true, "smoke-3 ingested");
  assert((await client.listSources("articles")).length === 2, "notebook holds 2 under cap");
  delete process.env.NOTEBOOKLM_SOURCE_CAP;

  // 6) Force remaining windows to the past, then rotate them out.
  for (const id of await retention.activeArticleIds(redis)) await redis.zadd("notebook:articles:expiry", 1, id);
  const { removed } = await runNotebookCleanup(redis);
  assert(removed >= 2, `cleanup removed remaining (got ${removed})`);
  assert((await client.listSources("articles")).length === 0, "sources removed from notebook");
  assert((await retention.getArticleState(redis, "smoke-1"))?.status === "removed", "engaged smoke-1 → removed");
  assert((await retention.sourceCount(redis, cfg.notebooks.articles)) === 0, "source count back to 0");

  console.log("TS_SMOKE_OK");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
