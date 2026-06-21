import { NextRequest } from "next/server";
import { getRedis } from "@/lib/redis";
import { enqueue } from "@/lib/jobs";
import { genId } from "@/lib/articles";

export const runtime = "nodejs";

const UID = "demo";
const exploreKey = (uid: string, jobId: string) => `explore:${uid}:${jobId}`;

interface ExploreRecord {
  jobId: string;
  uid: string;
  topic: string;
  status: "pending" | "researching" | "ready" | "error";
  steps: string[];
  sources: unknown[];
  synthesis: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/** Kick off a research job. Body: { topic }. Returns { jobId }. */
export async function POST(req: NextRequest) {
  let body: { topic?: string } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const topic = (body.topic ?? "").trim();
  if (!topic) return Response.json({ error: "Provide a topic to research" }, { status: 400 });

  const jobId = genId();
  const record: ExploreRecord = {
    jobId,
    uid: UID,
    topic,
    status: "pending",
    steps: [],
    sources: [],
    synthesis: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  try {
    const r = getRedis();
    await r.set(exploreKey(UID, jobId), JSON.stringify(record), "EX", 60 * 60 * 24);
    await enqueue("explore", { uid: UID, jobId, topic });
    return Response.json({ ok: true, jobId, status: "pending" });
  } catch {
    return Response.json({ error: "Couldn't reach the research queue. Is the worker running?" }, { status: 503 });
  }
}

/** Poll a research job's current state. Query: ?jobId=... */
export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) return Response.json({ error: "jobId required" }, { status: 400 });
  try {
    const raw = await getRedis().get(exploreKey(UID, jobId));
    if (!raw) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json(JSON.parse(raw));
  } catch {
    return Response.json({ error: "lookup failed" }, { status: 500 });
  }
}
