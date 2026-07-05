// Feedback persistence contract (ISP: a tiny, focused interface). Swap backends by
// adding an implementation + a factory entry in ./index.ts — callers never change.

export interface FeedbackEntry {
  /** What the learner said. */
  message: string;
  /** Screen/path the feedback came from, for context. */
  page?: string;
  /** Unix ms timestamp. */
  at: number;
}

export interface FeedbackStore {
  /** Record a feedback entry. Implementations must fail soft (never throw across the seam). */
  add(entry: FeedbackEntry): Promise<void>;
  /** Most-recent-first feedback, capped at `limit`. */
  list(limit?: number): Promise<FeedbackEntry[]>;
}
