import { NextRequest } from "next/server";
import { getHermes } from "@/lib/core/hermes";
import { getRedis } from "@/lib/redis";
import type { RedisLike } from "@/lib/core/store/types";

export const runtime = "nodejs";

/**
 * Read-only view of Tiru's self-improvement: the current discovery strategy,
 * learned skills, and recent reflections — all sourced from the living Vault
 * files Hermes maintains.
 */
export async function GET(req: NextRequest) {
  const p = new URL(req.url).searchParams.get("profile");
  const uid = p && /^[a-z0-9_-]+$/i.test(p) ? p : "demo";
  try {
    const hermes = getHermes(getRedis() as unknown as RedisLike);
    const summary = await hermes.summary(uid);
    return Response.json({ ok: true, uid, ...summary });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error).message) }, { status: 500 });
  }
}
