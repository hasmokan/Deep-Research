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
    chunks = None

    async def ainvoke(self, payload):
        return self.response

    async def astream(self, payload):
        chunks = self.chunks or [self.response]
        for chunk in chunks:
            yield chunk


def _fake_intent_response(intent: str):
    _FakeChain.response = SimpleNamespace(
        content=json.dumps({"intent": intent, "reason": "test route"}),
        additional_kwargs={},
    )
    _FakeChain.chunks = None


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
    def setUp(self):
        from services.langfuse_observability import NoopLangfuseTracer

        langfuse_patcher = patch(
            "agents.research_stream.get_langfuse_tracer",
            return_value=NoopLangfuseTracer(),
        )
        langfuse_patcher.start()
        self.addCleanup(langfuse_patcher.stop)

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

    async def test_first_turn_coding_request_streams_answer_without_web_search(self):
        from agents.nodes import conversation_router
        from agents.research_stream import stream_research_events

        _FakeChain.response = SimpleNamespace(content="```python\nprint('ok')\n```", additional_kwargs={})
        _FakeChain.chunks = [
            SimpleNamespace(content="```python\n", additional_kwargs={}),
            SimpleNamespace(content="print('ok')\n```", additional_kwargs={}),
        ]
        with (
            patch.object(conversation_router.ChatPromptTemplate, "from_messages", return_value=_FakePrompt()),
            patch.object(conversation_router, "ChatOpenAI"),
            patch("agents.research_stream.web_search_node", side_effect=AssertionError("should not search")),
        ):
            events = [
                event
                async for event in stream_research_events(
                    "帮我写一段力扣代码",
                    display_query="帮我写一段力扣代码",
                )
            ]

        status_events = [event for event in events if event.startswith("event: status")]
        status_payloads = [json.loads(event.split("data: ", 1)[1]) for event in status_events]
        delta_events = [event for event in events if event.startswith("event: answer_delta")]
        deltas = [json.loads(event.split("data: ", 1)[1])["delta"] for event in delta_events]
        complete_events = [event for event in events if event.startswith("event: complete")]
        payload = json.loads(complete_events[0].split("data: ", 1)[1])

        self.assertIn({"stage": "route", "label": "Understanding", "message": "Classifying the request."}, status_payloads)
        self.assertTrue(any(status["stage"] == "coding" for status in status_payloads))
        self.assertEqual(deltas, ["```python\n", "print('ok')\n```"])
        self.assertEqual(payload["result_type"], "answer")
        self.assertIn("print('ok')", payload["answer"])
        _FakeChain.chunks = None

    async def test_first_turn_create_and_run_file_routes_to_coding(self):
        from agents.nodes import conversation_router

        state = {
            "query": "创建 hello.py 打印 ok，然后运行它",
            "display_query": "创建 hello.py 打印 ok，然后运行它",
            "latest_result": None,
        }

        routed_state = await _classify_with_fake_llm(conversation_router, state, "coding_help")

        self.assertEqual(routed_state["intent"], "coding_help")
        self.assertEqual(conversation_router.route_research_intent(routed_state), "answer_coding")

    async def test_follow_up_coding_request_routes_to_coding_not_new_research(self):
        from agents.nodes import conversation_router

        state = {
            "query": "帮我写一段 ai 代码",
            "display_query": "帮我写一段 ai 代码",
            "latest_result": LATEST_RESULT,
        }

        routed_state = await _classify_with_fake_llm(conversation_router, state, "coding_help")

        self.assertEqual(routed_state["intent"], "coding_help")
        self.assertEqual(conversation_router.route_research_intent({**state, **routed_state}), "answer_coding")

    async def test_public_identity_question_still_routes_to_web_research(self):
        from agents.nodes import conversation_router

        state = {
            "query": "谁是hasmokan",
            "display_query": "谁是hasmokan",
            "latest_result": None,
        }

        routed_state = await _classify_with_fake_llm(conversation_router, state, "new_research")

        self.assertEqual(routed_state["intent"], "new_research")
        self.assertEqual(conversation_router.route_research_intent(routed_state), "web_search")


class FollowUpResearchRouteTests(TestCase):
    def test_execute_research_passes_latest_result_to_agent_state(self):
        from routers import research
        from services.auth import AuthenticatedUser

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

        with (
            patch.object(research.research_agent, "ainvoke", side_effect=fake_ainvoke),
            patch.object(research, "research_memory_store", EmptyMemoryStore()),
        ):
            result = asyncio.run(
                research.execute_research(
                    ResearchRequest(query="来源是？", latest_result=LATEST_RESULT),
                    AuthenticatedUser(user_id="user-1"),
                )
            )

        self.assertEqual(result["result_type"], "answer")
        self.assertIn("https://example.com/report", result["answer"])

    def test_coding_request_plan_is_skipped(self):
        from agents.nodes.plan import assess_research_plan_need

        result = asyncio.run(assess_research_plan_need("帮我写一段力扣代码"))

        self.assertFalse(result["should_plan"])
        self.assertIn("coding", result["reason"])


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
