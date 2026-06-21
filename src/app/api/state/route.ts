import { NextRequest } from "next/server";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";

// Per-profile state key, e.g. tiruno:state:student / :professional / :custom / :demo.
function keyFor(req: NextRequest) {
  const p = new URL(req.url).searchParams.get("profile");
  const id = p && /^[a-z0-9_-]+$/i.test(p) ? p : "demo";
  return `tiruno:state:${id}`;
}

export async function GET(req: NextRequest) {
  try {
    const raw = await getRedis().get(keyFor(req));
    return Response.json({ state: raw ? JSON.parse(raw) : null, source: "redis" });
  } catch {
    // Best-effort: if Redis is unavailable, the client just keeps local state.
    return Response.json({ state: null, source: "unavailable" });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    await getRedis().set(keyFor(req), JSON.stringify(body?.state ?? {}));
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, source: "unavailable" });
  }
}
