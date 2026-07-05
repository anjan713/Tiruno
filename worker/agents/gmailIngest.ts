import type Redis from "ioredis";
import { execFile } from "node:child_process";
import { makeBus } from "../lib/bus";
import { runIngestArticle } from "./notebookIngest";

export interface IngestGmailJob {
  uid: string;
  jobId: string;
  max?: number;
}

export interface EmailMessage {
  id: string;
  subject: string;
  from: string;
  body: string;
  date?: number;
}

interface GmailProvider {
  readonly name: string;
  fetchNewsletters(max: number): Promise<EmailMessage[]>;
}

function stripHtml(s: string): string {
  return s
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Hermetic provider for dev/tests (GMAIL_MOCK=1): canned newsletter bodies. */
class MockGmailProvider implements GmailProvider {
  readonly name = "mock";
  async fetchNewsletters(max: number): Promise<EmailMessage[]> {
    const msgs: EmailMessage[] = [
      {
        id: "mock-nl-1",
        subject: "TLDR — Postgres 17 ships incremental backups",
        from: "TLDR <dan@tldrnewsletter.com>",
        body: "Postgres 17 introduces incremental backups via pg_basebackup, cutting backup time and storage for large databases. The walsummarizer process tracks changed blocks so only deltas are copied. Logical replication also gains failover slot support.",
        date: Date.now(),
      },
      {
        id: "mock-nl-2",
        subject: "Bytes — Why your bundle is slow",
        from: "Bytes <hello@bytes.dev>",
        body: "Tree-shaking only works on ES modules with no side effects. Mark packages sideEffects:false, prefer named imports, and audit with source-map-explorer. Dynamic import() splits routes so the initial payload stays small.",
        date: Date.now(),
      },
    ];
    return msgs.slice(0, Math.max(0, max));
  }
}

/** Real provider: shell out to a Gmail MCP CLI (GMAIL_CMD), expecting JSON. */
class CliGmailProvider implements GmailProvider {
  readonly name = "cli";
  constructor(private cmd: string) {}

  async fetchNewsletters(max: number): Promise<EmailMessage[]> {
    const [bin, ...base] = this.cmd.split(/\s+/);
    const args = [...base, "--max", String(max), "--json"];
    return new Promise<EmailMessage[]>((resolve) => {
      execFile(bin, args, { timeout: 60000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
        if (err) {
          if (process.env.NODE_ENV !== "production") console.warn("[gmailIngest]", err.message);
          resolve([]);
          return;
        }
        try {
          const raw = String(stdout || "");
          const obj = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
          const list = Array.isArray(obj.messages) ? obj.messages : [];
          resolve(
            list
              .filter((m: unknown): m is Record<string, unknown> => !!m && typeof m === "object")
              .map((m: Record<string, unknown>, i: number) => ({
                id: String(m.id ?? `gmail-${i}`),
                subject: String(m.subject ?? "Newsletter"),
                from: String(m.from ?? ""),
                body: stripHtml(String(m.body ?? m.text ?? m.html ?? "")),
                date: m.date ? Number(m.date) : Date.now(),
              }))
          );
        } catch {
          resolve([]);
        }
      });
    });
  }
}

function getGmailProvider(): GmailProvider | null {
  if (process.env.GMAIL_MOCK === "1") return new MockGmailProvider();
  const cmd = (process.env.GMAIL_CMD || "").trim();
  if (process.env.GMAIL_ENABLED === "1" && cmd) return new CliGmailProvider(cmd);
  return null;
}

/**
 * Gmail-ingestion agent: pull newsletter bodies (Gmail MCP, pluggable), then feed
 * each into the NotebookLM ingestion pipeline as an uploaded file source (emails
 * are never added as URLs). No-ops gracefully when Gmail isn't configured.
 */
export async function runIngestGmail(redis: Redis, job: IngestGmailJob): Promise<void> {
  const bus = makeBus(redis);
  const provider = getGmailProvider();

  await bus.publish(job.uid, { jobId: job.jobId, type: "progress", status: "researching", step: "Checking your inbox…" });

  if (!provider) {
    await bus.publish(job.uid, {
      jobId: job.jobId,
      type: "done",
      status: "ready",
      result: { ingested: 0, reason: "Gmail not configured (set GMAIL_MOCK=1 or GMAIL_ENABLED=1 + GMAIL_CMD)" },
    });
    return;
  }

  const max = Math.max(1, Math.min(20, job.max ?? 5));
  const messages = await provider.fetchNewsletters(max);
  const seenKey = `notebook:gmail:seen:${job.uid}`;
  const articleIds: string[] = [];
  let skipped = 0;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const body = stripHtml(m.body);
    if (!body || body.length < 40) continue;
    // Dedup: never re-ingest a message we've already processed.
    if (await redis.sismember(seenKey, m.id)) {
      skipped++;
      continue;
    }
    await bus.publish(job.uid, { jobId: job.jobId, type: "progress", step: `Ingesting "${m.subject}"…` });
    // Emails always take the file-upload route inside runIngestArticle (email: true).
    // Stable articleId per message → idempotent across runs.
    await runIngestArticle(redis, {
      uid: job.uid,
      jobId: `${job.jobId}-m${i}`,
      articleId: `gmail-${m.id}`,
      title: m.subject,
      text: body,
      topic: "Newsletter",
      email: true,
    });
    await redis.sadd(seenKey, m.id);
    articleIds.push(`gmail-${m.id}`);
  }

  await bus.publish(job.uid, {
    jobId: job.jobId,
    type: "done",
    status: "ready",
    result: { ingested: articleIds.length, skipped, via: provider.name, articleIds },
  });
}
