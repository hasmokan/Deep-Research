"""Conversation context handling for multi-turn research."""

import asyncio
from unittest import TestCase
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from main import app
from models.schemas import ResearchRequest


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


class ConversationResearchRouteTests(TestCase):
    def test_execute_research_uses_contextual_query_and_returns_display_query(self):
        from routers import research

        agent = AsyncMock(return_value={
            "query": "contextual query",
            "documents": [],
            "analysis": "analysis",
            "analysis_thinking": None,
            "report": "report",
            "report_thinking": None,
            "report_completed": True,
        })

        with patch.object(research.research_agent, "ainvoke", agent):
            result = asyncio.run(
                research.execute_research(
                    ResearchRequest(
                        query="展开第三点",
                        messages=[
                            {"role": "user", "content": "做研究"},
                            {"role": "assistant", "content": "第三点是问题意识的形成。"},
                        ],
                    )
                )
            )

        state = agent.await_args.args[0]
        self.assertIn("Previous conversation context:", state["query"])
        self.assertIn("Current user request:\n展开第三点", state["query"])
        self.assertEqual(state["display_query"], "展开第三点")
        self.assertEqual(result["query"], "展开第三点")

    def test_stream_post_accepts_history_messages(self):
        from agents.research_stream import format_sse_event
        from routers import research

        async def fake_stream(query, run_id=None, display_query=None, store=None):
            self.assertIn("Previous conversation context:", query)
            self.assertEqual(display_query, "展开第三点")
            yield format_sse_event("complete", {"query": display_query, "status": "completed"})

        client = TestClient(app)

        with patch.object(research.research_run_store, "create_run", return_value={
            "run_id": "run-test",
            "query": "展开第三点",
            "status": "running",
            "created_at": "2026-05-17T00:00:00+00:00",
            "updated_at": "2026-05-17T00:00:00+00:00",
        }):
            with patch.object(research.research_run_store, "append_event"):
                with patch.object(research, "stream_research_events", fake_stream):
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
