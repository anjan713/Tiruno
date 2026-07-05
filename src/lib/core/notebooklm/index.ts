// NotebookLM integration — public surface.
//
// Client wraps the `notebooklm-mcp-cli` operations (with a hermetic mock mode);
// retention.* manages the per-article lifecycle + rotation in Redis. See
// docs/notebooklm-ingestion.md and the worker agents (notebookIngest, gmailIngest,
// notebookCleanup) for the orchestration.

export * from "./types";
export { notebookLMConfig, notebookLMEnabled, type NotebookLMConfig } from "./config";
export { NotebookLMClient, NotebookLMError, __resetMockStore } from "./client";
export * as retention from "./retention";
