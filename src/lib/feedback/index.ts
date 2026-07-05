// Feedback store registry. Select/replace the backend here (OCP + DIP) — e.g. add a
// Postgres or HTTP store and switch on an env var without touching any caller.

import { RedisFeedbackStore } from "./redisStore";
import type { FeedbackStore } from "./types";

export type { FeedbackEntry, FeedbackStore } from "./types";
export { RedisFeedbackStore } from "./redisStore";

/** The active feedback store for a user. */
export function getFeedbackStore(uid: string): FeedbackStore {
  return new RedisFeedbackStore(uid);
}
