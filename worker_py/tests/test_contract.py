"""Offline parity tests for the Python worker port.

Covers the trickiest ported logic without a live Redis/LLM:
  - curator result parsing (fenced JSON, field mapping, fallback)
  - L1 level thresholds + String(number) formatting
  - Vault frontmatter round-trip (arrays + numbers)
  - Hermes reflect/evolve Redis-mirror contract (camelCase keys, version bump)

Run: ``./.venv-worker/bin/python -m unittest worker_py.tests.test_contract``
"""

import asyncio
import json
import os
import tempfile
import unittest

from worker_py.agents.curator import _parse_result
from worker_py.hermes import Hermes
from worker_py.loops.l1 import _num_str, score_to_level
from worker_py.summarize.local import local_summarize
from worker_py.vault.frontmatter import parse_frontmatter, serialize_frontmatter
from worker_py.vault.obsidian import ObsidianVault


class FakeRedis:
    """Minimal async Redis stub for list ops used by Hermes."""

    def __init__(self):
        self.lists = {}

    async def lpush(self, k, v):
        self.lists.setdefault(k, []).insert(0, v)
        return len(self.lists[k])

    async def ltrim(self, k, a, b):
        if k in self.lists:
            self.lists[k] = self.lists[k][a : b + 1]

    async def lrange(self, k, a, b):
        return self.lists.get(k, [])[a : b + 1]


class TestCuratorParse(unittest.TestCase):
    def test_fenced_json(self):
        text = '```json\n{"sources":[{"title":"A","url":"https://a.com","source":"reddit","engagement":"10","snippet":"why"}],"synthesis":"S"}\n```'
        out = _parse_result(text)
        self.assertEqual(out["synthesis"], "S")
        self.assertEqual(len(out["sources"]), 1)
        s = out["sources"][0]
        self.assertEqual(s, {"title": "A", "url": "https://a.com", "source": "reddit", "engagement": "10", "snippet": "why"})

    def test_defaults_and_filtering(self):
        text = '{"sources":[{"title":"A"},{"nope":1}],"synthesis":3}'
        out = _parse_result(text)
        # second entry dropped (no title); url->"", source->"web"; engagement/snippet omitted
        self.assertEqual(out["sources"], [{"title": "A", "url": "", "source": "web"}])
        # non-string synthesis falls back to truncated raw text
        self.assertEqual(out["synthesis"], text[:1200])

    def test_garbage_fallback(self):
        out = _parse_result("not json at all")
        self.assertEqual(out["sources"], [])
        self.assertEqual(out["synthesis"], "not json at all")


class TestL1(unittest.TestCase):
    def test_score_to_level(self):
        self.assertEqual(score_to_level(0), "eli5")
        self.assertEqual(score_to_level(32.9), "eli5")
        self.assertEqual(score_to_level(33), "intermediate")
        self.assertEqual(score_to_level(66.9), "intermediate")
        self.assertEqual(score_to_level(67), "expert")
        self.assertEqual(score_to_level(100), "expert")

    def test_num_str_matches_js(self):
        self.assertEqual(_num_str(55), "55")
        self.assertEqual(_num_str(55.0), "55")
        self.assertEqual(_num_str(55.5), "55.5")


class TestFrontmatter(unittest.TestCase):
    def test_round_trip(self):
        fm = {"version": 2, "noveltyExplore": 0.25, "sourceMix": ["reddit", "web"], "note": "has: colon"}
        raw = serialize_frontmatter(fm, "# body\n")
        parsed, content = parse_frontmatter(raw)
        self.assertEqual(parsed["version"], 2)
        self.assertEqual(parsed["noveltyExplore"], 0.25)
        self.assertEqual(parsed["sourceMix"], ["reddit", "web"])
        self.assertEqual(parsed["note"], "has: colon")
        # Body preserved (parser strips a single leading newline, matching the TS port).
        self.assertEqual(content.lstrip("\n"), "# body\n")


class TestLocalSummarize(unittest.TestCase):
    def test_empty(self):
        self.assertIn("isn't enough text", local_summarize(""))

    def test_title_prefix(self):
        out = local_summarize("This is a clear sentence about something useful and interesting today.", "Thing")
        self.assertTrue(out.startswith('Here\'s what "Thing" is about.'))


class TestHermesContract(unittest.TestCase):
    def test_reflect_and_evolve_mirror(self):
        async def run():
            with tempfile.TemporaryDirectory() as tmp:
                fake = FakeRedis()
                h = Hermes(redis=fake, vault=ObsidianVault(root=tmp), llm=None)
                h.llm = None  # force deterministic (no-LLM) path
                nxt = await h.reflect_and_evolve("demo")

                # version bumped from default v1 -> v2
                self.assertEqual(nxt["version"], 2)
                self.assertEqual(nxt["noveltyExplore"], 0.2)

                # Redis mirror keys + camelCase contract
                mirror = fake.lists["strategy:discovery:demo"][0]
                obj = json.loads(mirror)
                self.assertEqual(
                    set(obj.keys()),
                    {"version", "noveltyExplore", "sourceMix", "preferred", "avoid", "note", "at"},
                )
                self.assertEqual(obj["version"], 2)

                imp = json.loads(fake.lists["improvements:log"][0])
                self.assertEqual(set(imp.keys()), {"uid", "version", "note", "at"})
                self.assertEqual(imp["uid"], "demo")

                # Living markdown file written + re-readable as v2
                note = await h.vault.read("strategies/discovery-demo")
                self.assertIsNotNone(note)
                self.assertEqual(int(note.frontmatter["version"]), 2)
                self.assertEqual(note.frontmatter["sourceMix"], ["reddit", "hackernews", "github", "youtube", "x", "web"])

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
