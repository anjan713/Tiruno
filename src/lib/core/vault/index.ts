// Vault registry. Currently a single Obsidian-compatible filesystem backend,
// always available (no external service). New backends (S3, git, a DB-backed
// notes store) implement the Vault interface and plug in here.

import { ObsidianVault } from "./obsidian";
import type { Vault } from "./types";

export type { Vault, VaultNote, VaultSearchHit, VaultWriteOptions } from "./types";
export { ObsidianVault } from "./obsidian";

let cached: Vault | undefined;

/** The active vault (Obsidian-compatible folder at TIRUNO_VAULT_DIR or ./vault). */
export function getVault(): Vault {
  if (!cached) cached = new ObsidianVault();
  return cached;
}

export function vaultProviderName(): string {
  return (process.env.VAULT_PROVIDER || "obsidian").toLowerCase();
}
