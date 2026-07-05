"""Obsidian-compatible vault backed by a folder on disk.
Port of ``src/lib/core/vault/obsidian.ts``.

Notes are plain ``.md`` files with optional frontmatter, browsable/editable in
Obsidian (point a vault at ``TIRUNO_VAULT_DIR``).
"""

import json
import os
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .frontmatter import parse_frontmatter, serialize_frontmatter


@dataclass
class VaultNote:
    path: str
    frontmatter: Dict[str, Any]
    content: str
    updated_at: float


@dataclass
class VaultSearchHit:
    path: str
    score: int
    snippet: str
    frontmatter: Dict[str, Any] = field(default_factory=dict)


class ObsidianVault:
    name = "obsidian"

    def __init__(self, root: Optional[str] = None) -> None:
        self.root = os.path.abspath(
            root or os.environ.get("TIRUNO_VAULT_DIR") or os.path.join(os.getcwd(), "vault")
        )

    def _abs(self, rel: str) -> str:
        clean = re.sub(r"^[/\\]+", "", rel)
        name = clean if clean.endswith(".md") else f"{clean}.md"
        full = os.path.abspath(os.path.join(self.root, name))
        if not full.startswith(self.root):
            raise ValueError(f"vault path escapes root: {rel}")
        return full

    def _rel(self, abs_path: str) -> str:
        return os.path.relpath(abs_path, self.root).replace(os.sep, "/")

    async def read(self, p: str) -> Optional[VaultNote]:
        try:
            full = self._abs(p)
            with open(full, "r", encoding="utf-8") as fh:
                raw = fh.read()
            st = os.stat(full)
            frontmatter, content = parse_frontmatter(raw)
            return VaultNote(
                path=self._rel(full),
                frontmatter=frontmatter,
                content=content,
                updated_at=st.st_mtime * 1000,
            )
        except Exception:  # noqa: BLE001
            return None

    async def write(self, p: str, content: str, frontmatter: Optional[Dict[str, Any]] = None) -> None:
        full = self._abs(p)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as fh:
            fh.write(serialize_frontmatter(frontmatter or {}, content))

    async def append(self, p: str, content: str) -> None:
        existing = await self.read(p)
        if existing:
            merged = re.sub(r"\s+$", "", existing.content) + "\n\n" + content
            await self.write(p, merged, existing.frontmatter)
        else:
            await self.write(p, content)

    async def list(self, dir: str = "") -> List[str]:
        base = os.path.abspath(os.path.join(self.root, re.sub(r"^[/\\]+", "", dir)))
        out: List[str] = []
        for root, _dirs, files in os.walk(base):
            for fname in files:
                if fname.endswith(".md"):
                    out.append(self._rel(os.path.join(root, fname)))
        out.sort()
        return out

    async def search(self, query: str, dir: str = "", limit: int = 10) -> List[VaultSearchHit]:
        terms = [t for t in query.lower().split() if t]
        if not terms:
            return []
        paths = await self.list(dir)
        hits: List[VaultSearchHit] = []

        for p in paths:
            note = await self.read(p)
            if not note:
                continue
            hay = f"{json.dumps(note.frontmatter)} {note.content}".lower()
            score = sum(hay.count(t) for t in terms)
            if score > 0:
                idx = note.content.lower().find(terms[0])
                start = max(0, idx - 60)
                snippet = re.sub(r"\s+", " ", note.content[start : start + 200]).strip()
                hits.append(VaultSearchHit(path=p, score=score, snippet=snippet, frontmatter=note.frontmatter))

        hits.sort(key=lambda h: h.score, reverse=True)
        return hits[:limit]

    async def remove(self, p: str) -> None:
        try:
            os.unlink(self._abs(p))
        except FileNotFoundError:
            pass
