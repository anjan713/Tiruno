// Summarizer contract. Adapters: LLM-based (clear, grounded summaries on any
// provider), NotebookLM-CLI (optional, insulated behind this interface), and a
// dependency-free extractive fallback. Select via getSummarizer().

export interface SummarizeInput {
  text: string;
  title?: string;
  url?: string;
}

export interface Summarizer {
  readonly name: string;
  /** Return a clear, read-aloud-friendly summary (plain prose, no markdown). */
  summarize(input: SummarizeInput): Promise<string>;
}
