"""Minimal, dependency-free frontmatter (YAML-subset) parser/serializer.
Port of ``src/lib/core/vault/frontmatter.ts``.

Supports strings, numbers, booleans, and flat arrays of scalars.
"""

import json
import re
from typing import Any, Dict, List, Tuple, Union

_NUM_RE = re.compile(r"^-?\d+(\.\d+)?$")
_KV_RE = re.compile(r"^([A-Za-z0-9_-]+):\s*(.*)$")


def _parse_scalar(raw: str) -> Any:
    v = raw.strip()
    if v == "":
        return ""
    if v == "true":
        return True
    if v == "false":
        return False
    if v == "null":
        return None
    if _NUM_RE.match(v):
        return float(v) if "." in v else int(v)
    if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
        return v[1:-1]
    return v


def parse_frontmatter(raw: str) -> Tuple[Dict[str, Any], str]:
    if not raw.startswith("---"):
        return {}, raw
    end = raw.find("\n---", 3)
    if end == -1:
        return {}, raw

    header = raw[3:end].strip()
    content = re.sub(r"^\r?\n", "", raw[end + 4 :])
    frontmatter: Dict[str, Any] = {}

    for line in re.split(r"\r?\n", header):
        m = _KV_RE.match(line)
        if not m:
            continue
        key, val_raw = m.group(1), m.group(2)
        val = val_raw.strip()
        if val.startswith("[") and val.endswith("]"):
            inner = val[1:-1].strip()
            frontmatter[key] = [_parse_scalar(s) for s in inner.split(",")] if inner else []
        else:
            frontmatter[key] = _parse_scalar(val)
    return frontmatter, content


def _serialize_scalar(v: Union[str, int, float, bool, None]) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, str):
        # Quote strings that could be misread (contain :, #, leading/trailing space).
        return json.dumps(v) if re.search(r"[:#]|^\s|\s$", v) else v
    if v is None:
        return "null"
    return str(v)


def serialize_frontmatter(frontmatter: Dict[str, Any], content: str) -> str:
    keys = list(frontmatter.keys())
    if not keys:
        return content if content.endswith("\n") else content + "\n"

    lines: List[str] = []
    for k in keys:
        v = frontmatter[k]
        if isinstance(v, list):
            lines.append(f"{k}: [{', '.join(_serialize_scalar(x) for x in v)}]")
        else:
            lines.append(f"{k}: {_serialize_scalar(v)}")
    body = content if content.endswith("\n") else content + "\n"
    return "---\n" + "\n".join(lines) + "\n---\n\n" + body
