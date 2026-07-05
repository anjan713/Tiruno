# Tiruno Python Worker

A faithful, drop-in rewrite of the Node worker (`worker/`) in Python. It consumes
the **same** `jobs:agent` Redis Stream, writes the **same** state keys, and
publishes the **same** realtime bus messages — so the Next.js app drives it
unchanged. You can even run it side-by-side with the Node worker on the same
consumer group (jobs load-balance between consumers).

## Why a Python worker?

The worker is pure backend/compute: it pulls jobs off Redis, runs agents/LLMs,
and writes results back to Redis. Nothing about that is JS-specific. Redis is the
contract boundary, so the language on either side is an implementation detail.

## Layout

```
worker_py/
  main.py          # entry: XREADGROUP loop + deterministic router (≈ worker/index.ts)
  config.py        # env loading + stream/group constants
  store.py         # async redis client factory (REDIS_URL / REDIS_HOST…)
  bus.py           # rt:{uid} pub/sub + events:{uid} stream  (≈ worker/lib/bus.ts)
  http.py          # async fetch w/ retry+backoff  (≈ src/lib/core/http.ts)
  util.py          # now_ms(), fire() (fire-and-forget tasks)
  llm/             # provider registry: anthropic | openai | ollama | claude-agent
  agent/           # runner registry: Claude Agent SDK (skills) | plain LLM
  rag/             # embeddings + RediSearch vector index (idx:materials)
  vault/           # Obsidian-compatible markdown memory
  summarize/       # notebooklm | llm | local chain
  notebooklm/      # NotebookLM client (CLI wrapper + hermetic mock) + retention/rotation
  articles.py      # article store + readable-text fetch (subset of src/lib/articles.ts)
  hermes/          # self-improving loop (strategy/skills/episodes/reflections)
  loops/           # l1 (personalization) + l2 (discovery/self-grading)
  agents/          # curator, lesson, orchestrator, voice, learning_path,
                   #   notebook_ingest, gmail_ingest, notebook_retention
  tests/           # offline parity + NotebookLM tests (no Redis/LLM needed)
```

## Setup

```bash
python3 -m venv .venv-worker
./.venv-worker/bin/pip install -r worker_py/requirements.txt
```

`claude-agent-sdk` is optional — without it (or without Anthropic creds) the
worker automatically falls back to the plain single-completion LLM runner, and
skill-based agents (e.g. `last30days`) degrade gracefully.

## Run

From the **repo root** (so `.env.local` / `.claude/skills` resolve):

```bash
./.venv-worker/bin/python -m worker_py
```

This replaces `npm run worker`. Stop the Node worker first (or run both — they
share the `workers` group).

## Environment

Loaded from `.env.local` then `.env` (same as the Node worker). Key vars:

| Var | Purpose |
| --- | --- |
| `REDIS_URL` *(or `REDIS_HOST`/`REDIS_PORT`/`REDIS_PWD`/`REDIS_SSL`)* | Redis connection |
| `LLM_PROVIDER` | `claude-agent` \| `anthropic` \| `openai` \| `ollama` (else auto from keys) |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `OLLAMA_HOST` | provider creds |
| `EMBEDDINGS_PROVIDER` | embeddings backend (else local FNV fallback) |
| `TIRUNO_VAULT_DIR` | Hermes/Vault markdown root (default `./vault`) |
| `AGENT_RUNNER` | force `claude` or `llm` |
| `SUMMARIZER` / `NOTEBOOKLM_ENABLED` | summarizer selection |
| `NOTEBOOKLM_MOCK` | `1` = hermetic in-memory NotebookLM (no CLI/Google session) |
| `NOTEBOOKLM_CLI` | ingestion CLI base command (no verb; distinct from summarizer's `NOTEBOOKLM_CMD`) |
| `NOTEBOOKLM_NOTEBOOK_COURSES` / `_ARTICLES` | notebook ids |
| `NOTEBOOKLM_RETENTION_DAYS` / `_SOURCE_CAP` / `_DATA_DIR` | rotation policy + upload dir |
| `NOTEBOOKLM_CLEANUP_INTERVAL_MS` / `NOTEBOOKLM_AUTO_INGEST` | rotation timer · curator auto-ingest toggle |
| `GMAIL_MOCK` / `GMAIL_ENABLED` + `GMAIL_CMD` / `GMAIL_POLL_INTERVAL_MS` | Gmail-ingestion provider + poll timer |
| `WORKER_MAX_ATTEMPTS` | retries before dead-lettering to `jobs:agent:dead` (default 3) |

## Redis contract (must match the Node worker exactly)

- **Queue**: stream `jobs:agent`, group `workers`, fields `type` + `payload` (JSON,
  plus optional `attempt`). Failed jobs retry with backoff then dead-letter to
  `jobs:agent:dead` after `WORKER_MAX_ATTEMPTS` (default 3).
- **Job types**: `explore`, `find_articles`, `orchestrate`, `rebuild_path`,
  `narrate`, `make_digest`, `signal`, `curate`, `generate_lesson`,
  `ingest_article`, `ingest_gmail`, `notebook_cleanup`, `notebook_engagement`.
- **Enqueued by**: the Next.js app (`/api/explore`, `/api/lesson`, `/api/ingest`,
  `/api/gmail`, `/api/notebook/cleanup`, `/api/notebook/engagement`), the curator
  (acquire→ingest bridge), and the worker scheduler (periodic cleanup / Gmail poll).
- **Realtime**: publish on `rt:{uid}`, mirror to capped stream `events:{uid}`.
- **State keys**: `explore:{uid}:{jobId}`, `lesson:gen:{id}`, `lessonjob:{jobId}`,
  `path:{uid}`, `profile:gap:{uid}`, `signals:{uid}`, `understanding:{uid}:{topic}`,
  `suggestions:{uid}` / `:outcomes`, `seen_sources:{uid}`, `seen_authors:{uid}`,
  `strategy:discovery:{uid}`, `improvements:log`.
- **NotebookLM keys**: `notebook:articles:{articleId}` (lifecycle state),
  `notebook:articles:expiry` (ZSET, rotation), `notebook:sources:{notebookId}`
  (SET, cap), `notebook:url:{hash}` (URL→articleId dedup),
  `notebook:gmail:seen:{uid}` (SET, dedup), `podcast:{articleId}` (audio overview),
  `article:{id}` + `articles:index`.
- **Vector index**: `idx:materials` (HNSW, COSINE), key prefix `vec:`.

## Verify

Offline tests (no Redis/LLM required):

```bash
./.venv-worker/bin/python -m unittest worker_py.tests.test_contract worker_py.tests.test_notebooklm -v
```

NotebookLM mock end-to-end (no CLI/Google session/LLM): set `NOTEBOOKLM_MOCK=1`
and enqueue `ingest_article` / `ingest_gmail` (`GMAIL_MOCK=1`) / `notebook_cleanup`.
The TS side has an equivalent zero-infra smoke: `npx tsx scripts/notebooklm-smoke.ts`.

Live end-to-end (requires Redis up): start the worker, then drive it from the
running Next.js app (Explore / Lesson / "what next?"). Progress and results
stream over `/api/events` exactly as with the Node worker.
