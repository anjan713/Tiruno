import { NextRequest } from "next/server";
import { recordPrereqAcceptance, listPendingPrereqs } from "@/lib/learn/feedback";

export const runtime = "nodejs";

const UID = "demo";

// GET /api/prereq — pending prerequisites the learner accepted (for the Learn map).
export async function GET() {
  try {
    const prereqs = await listPendingPrereqs(UID);
    return Response.json({ prereqs });
  } catch {
    return Response.json({ prereqs: [] });
  }
}

// POST /api/prereq — record acceptance of "learn <prerequisite> first".
// Body: { blocker, blockerLabel, topicLabel, suggestion }
export async function POST(req: NextRequest) {
  let body: { blocker?: string; blockerLabel?: string; topicLabel?: string; suggestion?: string } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.blocker || !body.blockerLabel || !body.topicLabel) {
    return Response.json({ error: "blocker, blockerLabel, topicLabel required" }, { status: 400 });
  }
  try {
    await recordPrereqAcceptance(UID, {
      blocker: body.blocker,
      blockerLabel: body.blockerLabel,
      topicLabel: body.topicLabel,
      suggestion: body.suggestion || "",
    });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 200 });
  }
}
