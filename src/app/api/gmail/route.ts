import { NextRequest } from "next/server";
import { enqueue } from "@/lib/jobs";
import { genId } from "@/lib/articles";

export const runtime = "nodejs";

const UID = "demo";

/**
 * Pull recent newsletters from Gmail and ingest them as NotebookLM file sources.
 * Body: { max? } (1..20, default 5). Returns { jobId }.
 */
export async function POST(req: NextRequest) {
  let body: { max?: number } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const jobId = genId();
  try {
    await enqueue("ingest_gmail", {
      uid: UID,
      jobId,
      ...(typeof body.max === "number" ? { max: body.max } : {}),
    });
    return Response.json({ ok: true, jobId, status: "pending" });
  } catch {
    return Response.json({ error: "Couldn't reach the ingestion queue. Is the worker running?" }, { status: 503 });
  }
}
