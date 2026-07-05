"""Tests for the NotebookLM integration (client mock + retention lifecycle).

Run: ``./.venv-worker/bin/python -m unittest worker_py.tests.test_notebooklm -v``
"""

import os
from unittest import IsolatedAsyncioTestCase

from worker_py.notebooklm import NotebookLMClient, NotebookLMError, reset_mock_store, retention


class FakeRedis:
    """Async Redis stub: kv + sets + zsets (enough for retention)."""

    def __init__(self):
        self.kv = {}
        self.sets = {}
        self.zsets = {}

    async def get(self, k):
        return self.kv.get(k)

    async def set(self, k, v, ex=None):
        self.kv[k] = v
        return True

    async def sadd(self, k, *members):
        s = self.sets.setdefault(k, set())
        n = 0
        for m in members:
            if m not in s:
                s.add(m)
                n += 1
        return n

    async def srem(self, k, *members):
        s = self.sets.get(k)
        if not s:
            return 0
        n = 0
        for m in members:
            if m in s:
                s.discard(m)
                n += 1
        return n

    async def scard(self, k):
        return len(self.sets.get(k, ()))

    async def zadd(self, k, mapping):
        z = self.zsets.setdefault(k, {})
        added = 0
        for m, score in mapping.items():
            if m not in z:
                added += 1
            z[m] = score
        return added

    async def zrem(self, k, *members):
        z = self.zsets.get(k)
        if not z:
            return 0
        n = 0
        for m in members:
            if m in z:
                del z[m]
                n += 1
        return n

    async def zrange(self, k, start, stop):
        members = [m for m, _ in sorted(self.zsets.get(k, {}).items(), key=lambda kv: kv[1])]
        return members[start:] if stop == -1 else members[start : stop + 1]

    async def zrangebyscore(self, k, mn, mx):
        items = sorted(self.zsets.get(k, {}).items(), key=lambda kv: kv[1])
        return [m for m, s in items if mn <= s <= mx]


class TestClientMock(IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        os.environ["NOTEBOOKLM_MOCK"] = "1"
        reset_mock_store()
        self.client = NotebookLMClient()

    async def asyncTearDown(self):
        os.environ.pop("NOTEBOOKLM_MOCK", None)
        reset_mock_store()

    async def test_add_list_url_and_file(self):
        s1 = await self.client.add_url_source("articles", "https://a.com", "A")
        s2 = await self.client.upload_file_source("articles", "/tmp/x.md", "X")
        self.assertTrue(s1["id"].startswith("src-"))
        self.assertEqual(s1["kind"], "url")
        self.assertEqual(s2["kind"], "file")
        srcs = await self.client.list_sources("articles")
        self.assertEqual(len(srcs), 2)
        # deterministic ids (hash of notebook+url)
        self.assertEqual(s1["id"], (await self.client.add_url_source("articles", "https://a.com", "A"))["id"])

    async def test_audio_overview(self):
        a = await self.client.generate_audio_overview("articles", ["src-1"])
        self.assertTrue(a["audioUrl"].startswith("mock://audio/"))
        self.assertEqual(a["status"], "ready")

    async def test_activate_deactivate_remove(self):
        s = await self.client.add_url_source("articles", "https://a.com")
        await self.client.deactivate_source("articles", s["id"])
        self.assertFalse((await self.client.list_sources("articles"))[0]["active"])
        await self.client.activate_source("articles", s["id"])
        self.assertTrue((await self.client.list_sources("articles"))[0]["active"])
        await self.client.remove_source("articles", s["id"])
        self.assertEqual(await self.client.list_sources("articles"), [])

    async def test_notebook_isolation(self):
        await self.client.add_url_source("articles", "https://a.com")
        await self.client.add_url_source("courses", "https://c.com")
        self.assertEqual(len(await self.client.list_sources("articles")), 1)
        self.assertEqual(len(await self.client.list_sources("courses")), 1)

    async def test_disabled_raises(self):
        os.environ.pop("NOTEBOOKLM_MOCK", None)
        client = NotebookLMClient()  # config resolves to disabled
        with self.assertRaises(NotebookLMError):
            await client.add_url_source("articles", "https://a.com")
        os.environ["NOTEBOOKLM_MOCK"] = "1"


class TestRetention(IsolatedAsyncioTestCase):
    async def test_full_lifecycle(self):
        r = FakeRedis()
        st = await retention.record_ingested(
            r, article_id="art1", notebook="articles", source_id="src-1", source_kind="url", notebook_id="articles", retention_days=7
        )
        self.assertEqual(st["status"], "ingested")
        self.assertTrue(st["active"])
        self.assertEqual(await retention.source_count(r, "articles"), 1)
        # not due yet (now < expiresAt)
        self.assertEqual(await retention.due_for_removal(r, now=st["addedAt"]), [])

        await retention.record_assets(r, "art1", [{"kind": "podcast", "url": "u", "at": 1}])
        st2 = await retention.get_article_state(r, "art1")
        self.assertEqual(st2["status"], "assets")
        self.assertEqual(len(st2["assets"]), 1)

        st3 = await retention.touch_engagement(r, "art1", 90, 7)
        self.assertEqual(st3["status"], "engaged")
        self.assertEqual(st3["score"], 90)

        # now past the (extended) window → due
        self.assertEqual(await retention.due_for_removal(r, now=st3["expiresAt"] + 1), ["art1"])

        await retention.mark_removed(r, "art1", "articles")
        st4 = await retention.get_article_state(r, "art1")
        self.assertEqual(st4["status"], "removed")
        self.assertFalse(st4["active"])
        self.assertEqual(await retention.source_count(r, "articles"), 0)
        self.assertEqual(await retention.active_article_ids(r), [])

    async def test_active_ids_sorted_by_expiry(self):
        r = FakeRedis()
        for i in range(3):
            await retention.record_ingested(
                r, article_id=f"a{i}", notebook="articles", source_id=f"s{i}", source_kind="url", notebook_id="articles", retention_days=i + 1
            )
        ids = await retention.active_article_ids(r)
        self.assertEqual(ids, ["a0", "a1", "a2"])  # soonest-expiring first
        self.assertEqual(await retention.source_count(r, "articles"), 3)


if __name__ == "__main__":
    import unittest

    unittest.main()
