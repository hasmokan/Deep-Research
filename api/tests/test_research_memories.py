"""Per-user research memory storage."""

from tempfile import TemporaryDirectory
from unittest import TestCase


class ResearchMemoryStoreTests(TestCase):
    def test_json_memory_store_keeps_user_memories_isolated(self):
        from services.research_memories import JsonResearchMemoryStore

        with TemporaryDirectory() as tmpdir:
            store = JsonResearchMemoryStore(tmpdir)

            memory = store.remember_result(
                "user-1",
                {
                    "query": "部署 deep research",
                    "result_type": "report",
                    "status": "completed",
                },
                now="2026-05-18T00:00:00+00:00",
            )
            other_memory = store.get_memory("user-2")

        self.assertEqual(memory["user_id"], "user-1")
        self.assertEqual(memory["recent_topics"][0]["query"], "部署 deep research")
        self.assertEqual(other_memory["recent_topics"], [])

    def test_memory_context_is_compact_and_user_specific(self):
        from services.research_memories import JsonResearchMemoryStore, build_memory_context

        with TemporaryDirectory() as tmpdir:
            store = JsonResearchMemoryStore(tmpdir)
            store.remember_result(
                "user-1",
                {
                    "query": "普通 memo 怎么做",
                    "result_type": "answer",
                    "status": "completed",
                },
                now="2026-05-18T00:00:00+00:00",
            )

            context = build_memory_context(store.get_memory("user-1"))

        self.assertIn("Long-term user memo:", context)
        self.assertIn("普通 memo 怎么做", context)
