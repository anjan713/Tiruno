import { config } from "dotenv";
import { resolve } from "node:path";

/** Load .env.local (preferred) then .env, from the repo root. */
export function loadEnv(): void {
  const root = process.cwd();
  config({ path: resolve(root, ".env.local") });
  config({ path: resolve(root, ".env") });
}

/** Repo root — the worker is always launched from the project root (npm run worker). */
export const REPO_ROOT = process.cwd();

/** Single demo user for the hackathon. */
export const WORKER_UID = process.env.WORKER_UID || "demo";
