// Vault contract — "living files" memory backend.
//
// A Vault is a collection of markdown notes (with YAML-ish frontmatter) that
// agents read and write as durable, human-inspectable memory: episodic logs,
// learner profiles, Hermes discovery strategies, and evolved skills. The default
// adapter is an Obsidian-compatible folder on disk, so everything Tiruno "learns"
// is browsable/editable in Obsidian.

export interface VaultNote {
  /** Vault-relative path, e.g. "strategies/discovery.md". */
  path: string;
  frontmatter: Record<string, unknown>;
  /** Markdown body without the frontmatter block. */
  content: string;
  updatedAt: number;
}

export interface VaultSearchHit {
  path: string;
  score: number;
  snippet: string;
  frontmatter: Record<string, unknown>;
}

export interface VaultWriteOptions {
  frontmatter?: Record<string, unknown>;
}

export interface Vault {
  readonly name: string;
  /** Read a note, or null if it doesn't exist. */
  read(path: string): Promise<VaultNote | null>;
  /** Create/overwrite a note (frontmatter optional). */
  write(path: string, content: string, opts?: VaultWriteOptions): Promise<void>;
  /** Append markdown to a note, creating it if needed. */
  append(path: string, content: string): Promise<void>;
  /** List note paths under a directory (recursive). */
  list(dir?: string): Promise<string[]>;
  /** Keyword search across note bodies; returns ranked snippets. */
  search(query: string, opts?: { dir?: string; limit?: number }): Promise<VaultSearchHit[]>;
  /** Remove a note (no-op if absent). */
  remove(path: string): Promise<void>;
}
