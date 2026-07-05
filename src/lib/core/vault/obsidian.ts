import { promises as fs } from "node:fs";
import path from "node:path";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter";
import type { Vault, VaultNote, VaultSearchHit, VaultWriteOptions } from "./types";

/**
 * Obsidian-compatible vault backed by a folder on disk. Notes are plain `.md`
 * files with optional frontmatter, so the entire agent memory is browsable and
 * editable in Obsidian (point an Obsidian vault at TIRUNO_VAULT_DIR).
 */
export class ObsidianVault implements Vault {
  readonly name = "obsidian";
  private readonly root: string;

  constructor(root?: string) {
    this.root = path.resolve(root || process.env.TIRUNO_VAULT_DIR || path.join(process.cwd(), "vault"));
  }

  /** Resolve + sandbox a vault-relative path to an absolute path. */
  private abs(rel: string): string {
    const clean = rel.replace(/^[/\\]+/, "");
    const full = path.resolve(this.root, clean.endsWith(".md") ? clean : `${clean}.md`);
    if (!full.startsWith(this.root)) throw new Error(`vault path escapes root: ${rel}`);
    return full;
  }

  private rel(abs: string): string {
    return path.relative(this.root, abs).split(path.sep).join("/");
  }

  async read(p: string): Promise<VaultNote | null> {
    try {
      const abs = this.abs(p);
      const [raw, stat] = await Promise.all([fs.readFile(abs, "utf8"), fs.stat(abs)]);
      const { frontmatter, content } = parseFrontmatter(raw);
      return { path: this.rel(abs), frontmatter, content, updatedAt: stat.mtimeMs };
    } catch {
      return null;
    }
  }

  async write(p: string, content: string, opts: VaultWriteOptions = {}): Promise<void> {
    const abs = this.abs(p);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, serializeFrontmatter(opts.frontmatter ?? {}, content), "utf8");
  }

  async append(p: string, content: string): Promise<void> {
    const existing = await this.read(p);
    if (existing) {
      const merged = `${existing.content.replace(/\s+$/, "")}\n\n${content}`;
      await this.write(p, merged, { frontmatter: existing.frontmatter });
    } else {
      await this.write(p, content);
    }
  }

  async list(dir = ""): Promise<string[]> {
    const base = path.resolve(this.root, dir.replace(/^[/\\]+/, ""));
    const out: string[] = [];
    const walk = async (d: string): Promise<void> => {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) await walk(full);
        else if (e.isFile() && e.name.endsWith(".md")) out.push(this.rel(full));
      }
    };
    await walk(base);
    return out.sort();
  }

  async search(query: string, opts: { dir?: string; limit?: number } = {}): Promise<VaultSearchHit[]> {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const paths = await this.list(opts.dir ?? "");
    const hits: VaultSearchHit[] = [];

    for (const p of paths) {
      const note = await this.read(p);
      if (!note) continue;
      const hay = `${JSON.stringify(note.frontmatter)} ${note.content}`.toLowerCase();
      let score = 0;
      for (const t of terms) {
        const matches = hay.split(t).length - 1;
        score += matches;
      }
      if (score > 0) {
        const idx = note.content.toLowerCase().indexOf(terms[0]);
        const start = Math.max(0, idx - 60);
        const snippet = note.content.slice(start, start + 200).replace(/\s+/g, " ").trim();
        hits.push({ path: p, score, snippet, frontmatter: note.frontmatter });
      }
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, opts.limit ?? 10);
  }

  async remove(p: string): Promise<void> {
    try {
      await fs.unlink(this.abs(p));
    } catch {
      /* already gone */
    }
  }
}
