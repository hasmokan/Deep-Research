"""Conversation context handling for multi-turn research."""

import asyncio
from unittest import TestCase
from unittest.mock import patch

from fastapi.testclient import TestClient

from main import app
from models.schemas import ResearchRequest
from services.auth import AuthenticatedUser, get_current_user


class ConversationContextTests(TestCase):
    def test_research_request_accepts_history_messages(self):
        request = ResearchRequest(
            query="展开第三点",
            messages=[
                {"role": "user", "content": "做研究"},
                {"role": "assistant", "content": "Research report for 做研究..."},
            ],
        )

        self.assertEqual(request.query, "展开第三点")
        self.assertEqual(len(request.messages), 2)
        self.assertEqual(request.messages[0].role, "user")

    def test_contextual_query_combines_follow_up_with_recent_history(self):
        from agents.conversation_context import build_contextual_research_query

        contextual_query = build_contextual_research_query(
            "展开第三点",
            [
                {"role": "user", "content": "做研究"},
                {
                    "role": "assistant",
                    "content": "Research report for 做研究\n\n第三点是问题意识的形成。",
                },
            ],
        )

        self.assertIn("Current user request:\n展开第三点", contextual_query)
        self.assertIn("Previous conversation context:", contextual_query)
        self.assertIn("user: 做研究", contextual_query)
        self.assertIn("assistant: Research report for 做研究", contextual_query)

    def test_contextual_query_ignores_memory_context_without_thread_history(self):
        from agents.conversation_context import build_contextual_research_query

        contextual_query = build_contextual_research_query(
            "继续研究",
            [],
            memory_context="Local user memo:\nRecent research topics: deep research 部署",
        )

        self.assertEqual(contextual_query, "继续研究")

    def test_contextual_query_does_not_include_memory_context(self):
        from agents.conversation_context import build_contextual_research_query

        contextual_query = build_contextual_research_query(
            "谁是hasmokan",
            [
                {"role": "user", "content": "帮我查查夏日弥"},
                {"role": "assistant", "content": "夏日弥可能是一个 B 站账号。"},
            ],
            memory_context="Recent research topics: 夏日弥; 爬楼梯代码",
        )

        self.assertIn("Previous conversation context:", contextual_query)
        self.assertNotIn("Recent research topics", contextual_query)
        self.assertIn("Current user request:\n谁是hasmokan", contextual_query)


class ConversationResearchRouteTests(TestCase):
    def setUp(self):
        app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(user_id="user-1")
        self.memory_patcher = patch("routers.research.research_memory_store", EmptyMemoryStore())
        self.memory_patcher.start()

    def tearDown(self):
        app.dependency_overrides.clear()
        self.memory_patcher.stop()

    def test_execute_research_uses_contextual_query_and_returns_display_query(self):
        from agents.research_stream import format_sse_event
        from routers import research

        seen = {}

        async def fake_stream(
            query,
            run_id=None,
            thread_id=None,
            display_query=None,
            store=None,
            latest_result=None,
            execution_mode="auto",
            on_complete=None,
        ):
            seen["query"] = query
            seen["display_query"] = display_query
            seen["latest_result"] = latest_result
            seen["execution_mode"] = execution_mode
            payload = {
                "query": display_query,
                "documents": [],
                "analysis": "analysis",
                "analysis_thinking": None,
                "report": "report",
                "report_thinking": None,
                "status": "completed",
            }
            yield format_sse_event("values", payload)
            yield format_sse_event("end", None)

        with (
            patch.object(research, "stream_research_events", fake_stream),
            patch.object(research, "research_memory_store", TopicMemoryStore()),
        ):
            result = asyncio.run(
                research.execute_research(
                    ResearchRequest(
                        query="展开第三点",
                        messages=[
                            {"role": "user", "content": "做研究"},
                            {"role": "assistant", "content": "第三点是问题意识的形成。"},
                        ],
                    ),
                    AuthenticatedUser(user_id="user-1"),
                )
            )

        self.assertIn("Previous conversation context:", seen["query"])
        self.assertIn("Current user request:\n展开第三点", seen["query"])
        self.assertEqual(seen["display_query"], "展开第三点")
        self.assertEqual(result["query"], "展开第三点")

    def test_stream_post_accepts_history_messages(self):
        from agents.research_stream import format_sse_event
        from routers import research

        async def fake_stream(
            query,
            run_id=None,
            thread_id=None,
            display_query=None,
            store=None,
            latest_result=None,
            execution_mode="auto",
            on_complete=None,
        ):
            self.assertIn("Previous conversation context:", query)
            self.assertEqual(display_query, "展开第三点")
            self.assertIsNone(latest_result)
            yield format_sse_event("values", {"query": display_query, "status": "completed"})
            yield format_sse_event("end", None)

        async def fake_persisted_stream(run_id, user_id, store=None):
            yield format_sse_event("values", {"query": "展开第三点", "status": "completed"})
            yield format_sse_event("end", None)

        client = TestClient(app)

        with patch.object(research.research_run_store, "create_run", return_value={
            "run_id": "run-test",
            "query": "展开第三点",
            "status": "running",
            "created_at": "2026-05-17T00:00:00+00:00",
            "updated_at": "2026-05-17T00:00:00+00:00",
        }):
            with patch.object(research.research_run_store, "append_event"):
                with (
                    patch.object(research, "stream_research_events", fake_stream),
                    patch.object(research, "stream_persisted_research_run_events", side_effect=fake_persisted_stream),
                ):
                    response = client.post(
                        "/api/research/stream",
                        json={
                            "query": "展开第三点",
                            "messages": [
                                {"role": "user", "content": "做研究"},
                                {"role": "assistant", "content": "第三点是问题意识的形成。"},
                            ],
                        },
                    )

        self.assertEqual(response.status_code, 200)
        self.assertIn("text/event-stream", response.headers["content-type"])
        self.assertIn('"query":"展开第三点"', response.text)


class EmptyMemoryStore:
    def get_memory(self, user_id):
        return {
            "user_id": user_id,
            "summary": "",
            "recent_topics": [],
            "updated_at": "2026-05-18T00:00:00+00:00",
        }

    def remember_result(self, user_id, result):
        return self.get_memory(user_id)


class TopicMemoryStore(EmptyMemoryStore):
    def get_memory(self, user_id):
        return {
            "user_id": user_id,
            "summary": "Recent research topics: 做研究",
            "recent_topics": [
                {
                    "query": "做研究",
                    "result_type": "report",
                    "updated_at": "2026-05-18T00:00:00+00:00",
                },
            ],
            "updated_at": "2026-05-18T00:00:00+00:00",
        }
