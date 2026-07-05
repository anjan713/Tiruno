import { enqueue } from "@/lib/jobs";
import { genId } from "@/lib/articles";

export const runtime = "nodejs";

const UID = "demo";

/**
 * Trigger a NotebookLM rotation pass: remove expired sources and evict the
 * lowest-engagement ones over the per-notebook cap. Returns { jobId }.
 */
export async function POST() {
  const jobId = genId();
  try {
    await enqueue("notebook_cleanup", { uid: UID, jobId });
    return Response.json({ ok: true, jobId, status: "pending" });
  } catch {
    return Response.json({ error: "Couldn't reach the ingestion queue. Is the worker running?" }, { status: 503 });
  }
}
