"""Per-user research memory storage."""

from tempfile import TemporaryDirectory
from unittest import TestCase


class ResearchMemoryStoreTests(TestCase):
    def test_json_memory_store_keeps_user_memories_isolated_and_empty(self):
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
        self.assertEqual(memory["recent_topics"], [])
        self.assertEqual(other_memory["recent_topics"], [])

    def test_memory_store_ignores_answers_and_follow_up_queries(self):
        from services.research_memories import JsonResearchMemoryStore

        with TemporaryDirectory() as tmpdir:
            store = JsonResearchMemoryStore(tmpdir)

            answer_memory = store.remember_result(
                "user-1",
                {
                    "query": "帮我写一下爬楼梯的代码",
                    "result_type": "answer",
                    "status": "completed",
                },
                now="2026-05-18T00:00:00+00:00",
            )
            follow_up_memory = store.remember_result(
                "user-1",
                {
                    "query": "还有别的解法吗？",
                    "result_type": "report",
                    "status": "completed",
                },
                now="2026-05-18T00:00:01+00:00",
            )
            coding_memory = store.remember_result(
                "user-1",
                {
                    "query": "帮我写一段力扣代码",
                    "result_type": "report",
                    "status": "completed",
                },
                now="2026-05-18T00:00:02+00:00",
            )
            writing_memory = store.remember_result(
                "user-1",
                {
                    "query": "如何写 别踩白块儿",
                    "result_type": "report",
                    "status": "completed",
                },
                now="2026-05-18T00:00:03+00:00",
            )

        self.assertEqual(answer_memory["recent_topics"], [])
        self.assertEqual(follow_up_memory["recent_topics"], [])
        self.assertEqual(coding_memory["recent_topics"], [])
        self.assertEqual(writing_memory["recent_topics"], [])

    def test_memory_store_filters_legacy_recent_topics_on_read(self):
        from services.research_memories import JsonResearchMemoryStore, build_memory_context

        with TemporaryDirectory() as tmpdir:
            store = JsonResearchMemoryStore(tmpdir)
            store.save_memory(
                "user-1",
                {
                    "summary": "Recent research topics: 旧数据",
                    "recent_topics": [
                        {
                            "query": "帮我写一下爬楼梯的代码",
                            "result_type": "answer",
                            "updated_at": "2026-05-18T00:00:00+00:00",
                        },
                        {
                            "query": "还有别的解法吗？",
                            "result_type": "report",
                            "updated_at": "2026-05-18T00:00:01+00:00",
                        },
                        {
                            "query": "帮我写一段力扣代码",
                            "result_type": "report",
                            "updated_at": "2026-05-18T00:00:02+00:00",
                        },
                        {
                            "query": "如何写 别踩白块儿",
                            "result_type": "report",
                            "updated_at": "2026-05-18T00:00:03+00:00",
                        },
                        {
                            "query": "谁是hasmokan",
                            "result_type": "report",
                            "updated_at": "2026-05-18T00:00:04+00:00",
                        },
                    ],
                    "updated_at": "2026-05-18T00:00:04+00:00",
                },
            )

            memory = store.get_memory("user-1")
            context = build_memory_context(memory)

        self.assertEqual(memory["summary"], "")
        self.assertEqual(memory["recent_topics"], [])
        self.assertEqual(context, "")

    def test_memory_context_is_empty_until_durable_memory_writer_exists(self):
        from services.research_memories import JsonResearchMemoryStore, build_memory_context

        with TemporaryDirectory() as tmpdir:
            store = JsonResearchMemoryStore(tmpdir)
            store.remember_result(
                "user-1",
                {
                    "query": "普通 memo 怎么做",
                    "result_type": "report",
                    "status": "completed",
                },
                now="2026-05-18T00:00:00+00:00",
            )

            context = build_memory_context(store.get_memory("user-1"))

        self.assertEqual(context, "")

    def test_memory_context_does_not_label_recent_topics_as_long_term_facts(self):
        from services.research_memories import JsonResearchMemoryStore, build_memory_context

        with TemporaryDirectory() as tmpdir:
            store = JsonResearchMemoryStore(tmpdir)
            store.remember_result(
                "user-1",
                {
                    "query": "谁是hasmokan",
                    "result_type": "report",
                    "status": "completed",
                },
                now="2026-05-18T00:00:00+00:00",
            )

            context = build_memory_context(store.get_memory("user-1"))

        self.assertEqual(context, "")
