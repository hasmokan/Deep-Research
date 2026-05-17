"""Agent routing for artifact-aware follow-up questions."""

import asyncio
import json
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import patch

from models.schemas import ResearchRequest


LATEST_RESULT = {
    "query": "帮我调查一下青精单车在市场占有份额",
    "documents": [
        {
            "id": "web_1",
            "content": "**行业报告**\n\n青精单车市场份额数据。",
            "metadata": {
                "title": "青精单车市场份额报告",
                "url": "https://example.com/report",
                "source": "web",
            },
            "similarity": 1.0,
        }
    ],
    "analysis": "青精单车的份额来自行业报告。",
    "report": "# 青精单车市场份额\n\n结论来自行业报告。",
    "status": "completed",
}


class _FakePrompt:
    def __or__(self, llm):
        return _FakeChain()


class _FakeChain:
    response = SimpleNamespace(content="ok", additional_kwargs={})

    async def ainvoke(self, payload):
        return self.response


def _fake_intent_response(intent: str):
    _FakeChain.response = SimpleNamespace(
        content=json.dumps({"intent": intent, "reason": "test route"}),
        additional_kwargs={},
    )


async def _classify_with_fake_llm(conversation_router, state, intent: str):
    _fake_intent_response(intent)

    with (
        patch.object(conversation_router.ChatPromptTemplate, "from_messages", return_value=_FakePrompt()),
        patch.object(conversation_router, "ChatOpenAI") as chat_openai,
    ):
        result = await conversation_router.classify_research_intent_node(state)

    chat_openai.assert_called_once()
    return result


class ResearchRequestLatestResultTests(TestCase):
    def test_research_request_accepts_latest_result_artifact(self):
        request = ResearchRequest(query="来源是？", latest_result=LATEST_RESULT)

        self.assertEqual(request.latest_result["query"], LATEST_RESULT["query"])
        self.assertEqual(request.latest_result["documents"][0]["metadata"]["url"], "https://example.com/report")


class FollowUpRoutingNodeTests(IsolatedAsyncioTestCase):
    async def test_source_question_is_answered_from_latest_documents(self):
        from agents.nodes import conversation_router

        state = {
            "query": "来源是？",
            "display_query": "来源是？",
            "latest_result": LATEST_RESULT,
        }

        routed_state = await _classify_with_fake_llm(conversation_router, state, "source_question")
        self.assertEqual(routed_state["intent"], "source_question")
        self.assertEqual(conversation_router.route_research_intent({**state, **routed_state}), "answer_sources")

        answer_state = await conversation_router.answer_sources_node({**state, **routed_state})

        self.assertEqual(answer_state["result_type"], "answer")
        self.assertIn("青精单车市场份额报告", answer_state["answer"])
        self.assertIn("https://example.com/report", answer_state["answer"])

    async def test_document_ordinal_question_is_answered_from_latest_documents(self):
        from agents.nodes import conversation_router

        state = {
            "query": "第一条文档是什么？",
            "display_query": "第一条文档是什么？",
            "latest_result": LATEST_RESULT,
        }

        routed_state = await _classify_with_fake_llm(conversation_router, state, "source_question")

        self.assertEqual(routed_state["intent"], "source_question")
        self.assertEqual(conversation_router.route_research_intent({**state, **routed_state}), "answer_sources")

    async def test_source_question_stream_does_not_call_web_search(self):
        from agents.nodes import conversation_router
        from agents.research_stream import stream_research_events

        _fake_intent_response("source_question")
        with (
            patch.object(conversation_router.ChatPromptTemplate, "from_messages", return_value=_FakePrompt()),
            patch.object(conversation_router, "ChatOpenAI"),
            patch("agents.research_stream.web_search_node", side_effect=AssertionError("should not search")),
        ):
            events = [
                event
                async for event in stream_research_events(
                    "来源是？",
                    display_query="来源是？",
                    latest_result=LATEST_RESULT,
                )
            ]

        complete_events = [event for event in events if event.startswith("event: complete")]
        self.assertEqual(len(complete_events), 1)
        payload = json.loads(complete_events[0].split("data: ", 1)[1])

        self.assertEqual(payload["result_type"], "answer")
        self.assertIn("https://example.com/report", payload["answer"])

    async def test_document_ordinal_stream_does_not_call_web_search(self):
        from agents.nodes import conversation_router
        from agents.research_stream import stream_research_events

        _fake_intent_response("source_question")
        with (
            patch.object(conversation_router.ChatPromptTemplate, "from_messages", return_value=_FakePrompt()),
            patch.object(conversation_router, "ChatOpenAI"),
            patch("agents.research_stream.web_search_node", side_effect=AssertionError("should not search")),
        ):
            events = [
                event
                async for event in stream_research_events(
                    "第一条文档是什么？",
                    display_query="第一条文档是什么？",
                    latest_result=LATEST_RESULT,
                )
            ]

        complete_events = [event for event in events if event.startswith("event: complete")]
        self.assertEqual(len(complete_events), 1)
        payload = json.loads(complete_events[0].split("data: ", 1)[1])

        self.assertEqual(payload["result_type"], "answer")
        self.assertIn("https://example.com/report", payload["answer"])

    async def test_document_question_without_sources_returns_answer_not_search(self):
        from agents.nodes import conversation_router
        from agents.research_stream import stream_research_events

        latest_result = {
            **LATEST_RESULT,
            "documents": [],
            "report": "# 空报告\n\nNo relevant documents found.",
        }

        _fake_intent_response("source_question")
        with (
            patch.object(conversation_router.ChatPromptTemplate, "from_messages", return_value=_FakePrompt()),
            patch.object(conversation_router, "ChatOpenAI"),
            patch("agents.research_stream.web_search_node", side_effect=AssertionError("should not search")),
        ):
            events = [
                event
                async for event in stream_research_events(
                    "第一条文档是什么？",
                    display_query="第一条文档是什么？",
                    latest_result=latest_result,
                )
            ]

        complete_events = [event for event in events if event.startswith("event: complete")]
        payload = json.loads(complete_events[0].split("data: ", 1)[1])

        self.assertEqual(payload["result_type"], "answer")
        self.assertIn("没有返回可引用的来源文档", payload["answer"])

    async def test_artifact_follow_up_is_answered_from_latest_report(self):
        from agents.nodes import conversation_router

        state = {
            "query": "总结一下",
            "display_query": "总结一下",
            "latest_result": LATEST_RESULT,
        }

        routed_state = await _classify_with_fake_llm(conversation_router, state, "artifact_follow_up")
        self.assertEqual(routed_state["intent"], "artifact_follow_up")
        self.assertEqual(
            conversation_router.route_research_intent({**state, **routed_state}),
            "answer_from_artifact",
        )

        _FakeChain.response = SimpleNamespace(content="这是一份报告摘要。", additional_kwargs={})
        with (
            patch.object(conversation_router.ChatPromptTemplate, "from_messages", return_value=_FakePrompt()),
            patch.object(conversation_router, "ChatOpenAI"),
        ):
            answer_state = await conversation_router.answer_from_artifact_node({**state, **routed_state})

        self.assertEqual(answer_state["result_type"], "answer")
        self.assertEqual(answer_state["answer"], "这是一份报告摘要。")


class FollowUpResearchRouteTests(TestCase):
    def test_execute_research_passes_latest_result_to_agent_state(self):
        from routers import research

        async def fake_ainvoke(state):
            self.assertEqual(state["latest_result"]["query"], LATEST_RESULT["query"])
            return {
                "query": state["query"],
                "display_query": state["display_query"],
                "documents": LATEST_RESULT["documents"],
                "analysis": None,
                "analysis_thinking": None,
                "report": None,
                "report_thinking": None,
                "answer": "来源：https://example.com/report",
                "result_type": "answer",
                "report_completed": True,
            }

        with patch.object(research.research_agent, "ainvoke", side_effect=fake_ainvoke):
            result = asyncio.run(
                research.execute_research(
                    ResearchRequest(query="来源是？", latest_result=LATEST_RESULT)
                )
            )

        self.assertEqual(result["result_type"], "answer")
        self.assertIn("https://example.com/report", result["answer"])
