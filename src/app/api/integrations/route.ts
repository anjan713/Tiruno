import { getIntegrationsStatus } from "@/lib/core/integrations/status";

export const runtime = "nodejs";

// GET /api/integrations — availability snapshot for the UI (NotebookLM, Claude,
// Gmail, embeddings, vault) + Hermes skills learned in the last 30 days.
export async function GET() {
  try {
    const report = await getIntegrationsStatus();
    return Response.json(report);
  } catch (e) {
    return Response.json(
      {
        integrations: [],
        skillsLast30Days: 0,
        totalSkills: 0,
        generatedAt: Date.now(),
        error: (e as Error).message,
      },
      { status: 200 }
    );
  }
}
