import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-Sent Events bridge: subscribes to the worker's `rt:demo` pub/sub channel
 * and streams every realtime message to the browser. The client filters by jobId.
 */
export async function GET() {
  const channel = "rt:demo";
  const sub = getRedis().duplicate();
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          /* controller closed */
        }
      };
      send("retry: 3000\n\n");
      try {
        await sub.subscribe(channel);
      } catch {
        send(`data: ${JSON.stringify({ type: "error", error: "subscribe failed" })}\n\n`);
      }
      sub.on("message", (_ch, msg) => send(`data: ${msg}\n\n`));
      heartbeat = setInterval(() => send(": ping\n\n"), 15000);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      sub.unsubscribe(channel).catch(() => {});
      sub.quit().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
