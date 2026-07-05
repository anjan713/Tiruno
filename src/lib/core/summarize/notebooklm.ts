import { execFile } from "node:child_process";
import type { SummarizeInput, Summarizer } from "./types";

/**
 * NotebookLM summarizer (optional). NotebookLM has no official API; the
 * `notebooklm-mcp-cli` project (https://github.com/anjan713/notebooklm-mcp-cli)
 * drives it via an authenticated Google session, so this adapter shells out to
 * that CLI. It is fully insulated behind the Summarizer interface and degrades to
 * "" on any error so the registry can fall back to the LLM/local summarizer.
 *
 * Enable with NOTEBOOKLM_ENABLED=1 (or SUMMARIZER=notebooklm). Configure the
 * binary/subcommand with NOTEBOOKLM_CMD (default: "notebooklm-mcp-cli summarize").
 * The article URL is passed as the final argument when available; the article
 * text is piped on stdin as a fallback source. Requires a Node runtime with the
 * CLI installed and an authenticated Google session (worker / self-hosted).
 */
export class NotebookLMSummarizer implements Summarizer {
  readonly name = "notebooklm";

  async summarize({ text, title, url }: SummarizeInput): Promise<string> {
    if (process.env.NOTEBOOKLM_ENABLED !== "1" && (process.env.SUMMARIZER || "").toLowerCase() !== "notebooklm") {
      return "";
    }

    const cmd = (process.env.NOTEBOOKLM_CMD || "notebooklm-mcp-cli summarize").trim();
    const [bin, ...baseArgs] = cmd.split(/\s+/);
    const args = [...baseArgs];
    if (title) args.push("--title", title);
    if (url) args.push(url);

    const timeoutMs = Number(process.env.NOTEBOOKLM_TIMEOUT_MS ?? 120000);

    try {
      return await new Promise<string>((resolve) => {
        const child = execFile(
          bin,
          args,
          { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
          (err, stdout) => {
            if (err) {
              if (process.env.NODE_ENV !== "production") {
                console.warn("[summarize:notebooklm]", err.message);
              }
              resolve("");
              return;
            }
            resolve(String(stdout || "").trim());
          }
        );
        // Provide the article body on stdin as a source fallback.
        if (child.stdin) {
          child.stdin.end((text || "").slice(0, 200000));
        }
      });
    } catch {
      return "";
    }
  }
}
