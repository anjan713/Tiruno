"""NotebookLM client. Port of ``src/lib/core/notebooklm/client.ts``.

Typed wrapper over every ``notebooklm-mcp-cli`` operation the ingestion pipeline
needs: add URL source, upload file source, generate audio overview,
activate/deactivate source, remove source, list sources. In MOCK mode
(NOTEBOOKLM_MOCK=1) it runs a deterministic in-memory simulator so the whole
pipeline can be exercised without a CLI or Google session.
"""

import asyncio
import hashlib
import os
from typing import Any, Dict, List, Optional

from .cli import extract_field, run_cli
from .config import NotebookLMConfig, notebooklm_config


class NotebookLMError(Exception):
    pass


def _short_id(seed: str) -> str:
    return hashlib.sha1(seed.encode("utf-8")).hexdigest()[:12]


def _normalize_artifacts(js: Any) -> List[dict]:
    """Normalize ``nlm studio status --json`` output (array, or {artifacts:[...]})."""
    if isinstance(js, list):
        arr = js
    elif isinstance(js, dict) and isinstance(js.get("artifacts"), list):
        arr = js["artifacts"]
    else:
        arr = []
    out = []
    for a in arr:
        if isinstance(a, dict):
            out.append(
                {
                    "type": a.get("type") if isinstance(a.get("type"), str) else None,
                    "status": a.get("status") if isinstance(a.get("status"), str) else None,
                    "artifact_id": a.get("artifact_id") if isinstance(a.get("artifact_id"), str) else None,
                }
            )
    return out


# --- Mock simulator (process-local). Mirrors the real CLI's behavior. ---
_mock_store: Dict[str, Dict[str, dict]] = {}


def _mock_notebook(notebook_id: str) -> Dict[str, dict]:
    return _mock_store.setdefault(notebook_id, {})


def reset_mock_store() -> None:
    """Reset the in-memory mock (tests)."""
    _mock_store.clear()


class NotebookLMClient:
    def __init__(self, cfg: Optional[NotebookLMConfig] = None):
        self.cfg = cfg or notebooklm_config()

    def _notebook_id(self, nb: str) -> str:
        return self.cfg.notebooks[nb]

    def _ensure_enabled(self) -> None:
        if not self.cfg.enabled:
            raise NotebookLMError("NotebookLM is disabled (set NOTEBOOKLM_ENABLED=1 or NOTEBOOKLM_MOCK=1)")

    async def add_url_source(self, nb: str, url: str, title: Optional[str] = None) -> dict:
        self._ensure_enabled()
        nid = self._notebook_id(nb)
        if self.cfg.mock:
            src = {"id": f"src-{_short_id(nid + url)}", "title": title, "url": url, "kind": "url", "active": True}
            _mock_notebook(nid)[src["id"]] = src
            return dict(src)
        # `nlm source add <nb> --url <url>` (YouTube uses --youtube). Prints
        # "Source ID: <id>" as Rich text (no --json on `source add`).
        flag = "--youtube" if ("youtube.com" in url.lower() or "youtu.be" in url.lower()) else "--url"
        res = await run_cli(self.cfg, "addSource", [nid, flag, url])
        source_id = extract_field(res["raw"], r"Source ID:\s*(\S+)")
        if not res["ok"] or not source_id:
            raise NotebookLMError(res.get("error") or "addUrlSource failed")
        return {"id": source_id, "title": title, "url": url, "kind": "url", "active": True}

    async def upload_file_source(self, nb: str, file_path: str, title: Optional[str] = None) -> dict:
        self._ensure_enabled()
        nid = self._notebook_id(nb)
        if self.cfg.mock:
            src = {"id": f"src-{_short_id(nid + file_path)}", "title": title, "kind": "file", "active": True}
            _mock_notebook(nid)[src["id"]] = src
            return dict(src)
        # `nlm source add <nb> --file <path> --wait` (block until processed).
        res = await run_cli(self.cfg, "addSource", [nid, "--file", file_path, "--wait"], timeout_ms=self.cfg.audio_timeout_ms)
        source_id = extract_field(res["raw"], r"Source ID:\s*(\S+)")
        if not res["ok"] or not source_id:
            raise NotebookLMError(res.get("error") or "uploadFileSource failed")
        return {"id": source_id, "title": title, "kind": "file", "active": True}

    async def generate_audio_overview(self, nb: str, source_ids: Optional[List[str]] = None) -> dict:
        """Audio overview (podcast). Async: `audio create` -> poll `studio status`
        -> `download audio` to a local file (served by /api/podcast/[articleId])."""
        self._ensure_enabled()
        nid = self._notebook_id(nb)
        if self.cfg.mock:
            seed = ",".join(source_ids or []) or nid
            return {"audioUrl": f"mock://audio/{nid}/{_short_id(seed)}.wav", "status": "ready"}

        create_args = [nid, "--confirm", "--format", self.cfg.audio_format, "--length", self.cfg.audio_length]
        if source_ids:
            create_args += ["--source-ids", ",".join(source_ids)]
        created = await run_cli(self.cfg, "audioCreate", create_args)
        if not created["ok"]:
            raise NotebookLMError(created.get("error") or "audio create failed")
        artifact_id = extract_field(created["raw"], r"Artifact ID:\s*(\S+)")

        # Poll until the audio artifact reaches a terminal state.
        deadline = asyncio.get_event_loop().time() + self.cfg.audio_timeout_ms / 1000
        ready = False
        while asyncio.get_event_loop().time() < deadline:
            await asyncio.sleep(self.cfg.audio_poll_ms / 1000)
            status = await run_cli(self.cfg, "studioStatus", [nid, "--json", "--full"])
            artifacts = _normalize_artifacts(status.get("json"))
            audio = [a for a in artifacts if a["type"] == "audio"]
            if artifact_id:
                target = next((a for a in artifacts if a["artifact_id"] == artifact_id), None)
            else:
                target = audio[-1] if audio else None
            if target and target["status"] == "completed":
                ready = True
                break
            if target and target["status"] == "failed":
                raise NotebookLMError("audio generation failed")
        if not ready:
            raise NotebookLMError("audio generation timed out")

        out_path = os.path.join(self.cfg.data_dir, "podcasts", f"{nid}-{artifact_id or 'latest'}.m4a")
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        dl_args = [nid, "--output", out_path, *(["--id", artifact_id] if artifact_id else [])]
        dl = await run_cli(self.cfg, "downloadAudio", dl_args, timeout_ms=self.cfg.audio_timeout_ms)
        if not dl["ok"]:
            raise NotebookLMError(dl.get("error") or "audio download failed")
        if not os.path.exists(out_path):
            raise NotebookLMError("audio file missing after download")
        return {"audioUrl": out_path, "status": "ready"}

    async def activate_source(self, nb: str, source_id: str) -> None:
        await self._set_active(nb, source_id, True)

    async def deactivate_source(self, nb: str, source_id: str) -> None:
        await self._set_active(nb, source_id, False)

    async def _set_active(self, nb: str, source_id: str, active: bool) -> None:
        self._ensure_enabled()
        nid = self._notebook_id(nb)
        if self.cfg.mock:
            src = _mock_notebook(nid).get(source_id)
            if src:
                src["active"] = active
            return
        # The real `nlm` CLI exposes no source activate/deactivate verb — NotebookLM
        # source selection isn't scriptable. No-op: retention only needs
        # add/remove/list, and rotation removes sources outright.
        return

    async def remove_source(self, nb: str, source_id: str) -> None:
        self._ensure_enabled()
        if self.cfg.mock:
            _mock_notebook(self._notebook_id(nb)).pop(source_id, None)
            return
        # `nlm source delete <source-id> --confirm` (source IDs are global; no --notebook).
        res = await run_cli(self.cfg, "deleteSource", [source_id, "--confirm"])
        if not res["ok"]:
            raise NotebookLMError(res.get("error") or "removeSource failed")

    async def list_sources(self, nb: str) -> List[dict]:
        self._ensure_enabled()
        nid = self._notebook_id(nb)
        if self.cfg.mock:
            return [dict(s) for s in _mock_notebook(nid).values()]
        # `nlm source list <nb> --json` -> array of {id, title, source_type_name, ...}.
        res = await run_cli(self.cfg, "listSources", [nid, "--json"])
        if not res["ok"]:
            raise NotebookLMError(res.get("error") or "listSources failed")
        sources = res.get("json")
        out: List[dict] = []
        if isinstance(sources, list):
            for s in sources:
                if isinstance(s, dict) and (s.get("id") or s.get("source_id")):
                    type_name = str(s.get("source_type_name") or s.get("type") or "").lower()
                    kind = "url" if any(t in type_name for t in ("url", "youtube", "web", "link")) else "file"
                    out.append(
                        {
                            "id": str(s.get("id") or s.get("source_id")),
                            "title": str(s["title"]) if s.get("title") else None,
                            "active": None,
                            "kind": kind,
                            "url": str(s["url"]) if s.get("url") else None,
                        }
                    )
        return out
