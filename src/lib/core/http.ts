// Small shared HTTP helpers for provider adapters: timeout + retry/backoff on
// 429 and 5xx (honoring Retry-After). Kept dependency-free so every adapter —
// in the Next.js app and the standalone worker — can use it.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RetryOptions {
  attempts?: number;
  timeoutMs?: number;
  backoffMs?: number[];
}

/**
 * POST/GET with retry + backoff on transient failures. Throws on final failure
 * (non-2xx that isn't retryable, or exhausted retries).
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: RetryOptions = {}
): Promise<Response> {
  const attempts = opts.attempts ?? 4;
  const timeoutMs = opts.timeoutMs ?? 20000;
  const backoff = opts.backoffMs ?? [1000, 4000, 10000, 20000];
  let lastErr = "";

  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return res;
      lastErr = `${res.status} ${res.statusText}`;
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get("retry-after")) * 1000;
        if (i < attempts - 1) await sleep(retryAfter > 0 ? retryAfter : backoff[i]);
        continue;
      }
      // Non-retryable: surface server detail to ease debugging.
      const detail = await res.text().catch(() => "");
      throw new Error(`${lastErr}${detail ? ` — ${detail.slice(0, 300)}` : ""}`);
    } catch (e) {
      lastErr = (e as Error).message;
      if (i < attempts - 1) await sleep(backoff[i]);
    }
  }
  throw new Error(lastErr || "request failed");
}
