"""SSE stream behavior for research execution."""

import asyncio
import json
from unittest import TestCase
from unittest.mock import patch

from fastapi.testclient import TestClient

from main import app
from services.auth import AuthenticatedUser, get_current_user


class ResearchStreamTests(TestCase):
    def setUp(self):
        from agents import research_stream
        from services.langfuse_observability import NoopLangfuseTracer

        app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(user_id="user-1")
        self.addCleanup(app.dependency_overrides.clear)
        memory_patcher = patch("routers.research.research_memory_store", EmptyMemoryStore())
        memory_patcher.start()
        self.addCleanup(memory_patcher.stop)

        langfuse_patcher = patch.object(
            research_stream,
            "get_langfuse_tracer",
            return_value=NoopLangfuseTracer(),
        )
        langfuse_patcher.start()
        self.addCleanup(langfuse_patcher.stop)

    def test_formats_sse_event_with_json_payload(self):
        from agents.research_stream import format_sse_event

        event = format_sse_event("status", {"stage": "search", "message": "Searching"})

        self.assertEqual(
            event,
            'event: status\ndata: {"stage":"search","message":"Searching"}\n\n',
        )

    def test_stream_emits_trace_events_for_tool_call_and_sources(self):
        from agents import research_stream

        async def fake_web_search_node(state):
            return {
                "documents": [
                    {
                        "id": "web_0",
                        "content": "**Example Source**\n\nUseful source text.",
                        "metadata": {
                            "title": "Example Source",
                            "url": "https://example.com/source",
                            "source": "example.com",
                            "provider": "duckduckgo",
                            "type": "web_search",
                        },
                        "similarity": 1.0,
                    }
                ],
                "web_search_completed": True,
            }

        async def fake_analyze_node(state):
            yield {
                "type": "thinking",
                "id": "analysis-thinking",
                "stage": "analyze",
                "label": "Analysis thinking",
                "text": "Reading the source.",
            }
            yield {
                "type": "final",
                "state": {
                    "analysis": "The source is useful.",
                    "analysis_thinking": "Reading the source.",
                    "analysis_completed": True,
                },
            }

        async def fake_generate_node(state):
            yield {
                "type": "thinking",
                "id": "report-thinking",
                "stage": "report",
                "label": "Report thinking",
                "text": "Drafting the report.",
            }
            yield {
                "type": "final",
                "state": {
                    "report": "# Report\n\nThe source is useful.",
                    "report_thinking": "Drafting the report.",
                    "report_completed": True,
                },
            }

        with (
            patch.object(
                research_stream,
                "classify_research_intent_node",
                return_value={"intent": "new_research", "reason": "test"},
            ),
            patch.object(research_stream, "web_search_node", fake_web_search_node),
            patch.object(research_stream, "stream_analyze_node", fake_analyze_node),
            patch.object(research_stream, "stream_generate_node", fake_generate_node),
        ):
            events = asyncio.run(_collect_stream_events(research_stream.stream_research_events("test query")))

        trace_payloads = [
            json.loads(event.split("data: ", 1)[1])
            for event in events
            if event.startswith("event: trace")
        ]

        self.assertEqual(trace_payloads[0]["kind"], "reasoning")
        self.assertEqual(trace_payloads[0]["title"], "Route selected")
        self.assertEqual(trace_payloads[0]["route"], "web_search")
        self.assertIn("new_research", trace_payloads[0]["detail"])
        self.assertEqual(trace_payloads[1]["kind"], "tool_call")
        self.assertEqual(trace_payloads[1]["title"], "Search web")
        self.assertEqual(trace_payloads[2]["kind"], "tool_result")
        self.assertEqual(trace_payloads[2]["documents"][0]["title"], "Example Source")
        self.assertEqual(trace_payloads[2]["documents"][0]["url"], "https://example.com/source")
        thinking_payloads = [
            json.loads(event.split("data: ", 1)[1])
            for event in events
            if event.startswith("event: thinking")
        ]
        agent_messages = [
            json.loads(event.split("data: ", 1)[1])
            for event in events
            if event.startswith("event: agent_message")
        ]
        self.assertEqual(thinking_payloads[0]["id"], "analysis-thinking")
        self.assertEqual(thinking_payloads[0]["text"], "Reading the source.")
        self.assertEqual(thinking_payloads[1]["id"], "report-thinking")
        self.assertEqual(thinking_payloads[1]["text"], "Drafting the report.")
        self.assertEqual(agent_messages[0]["type"], "ai")
        self.assertEqual(agent_messages[0]["tool_calls"][0]["name"], "web_search")
        self.assertEqual(agent_messages[1]["type"], "tool")
        self.assertEqual(agent_messages[1]["tool_call_id"], agent_messages[0]["tool_calls"][0]["id"])
        self.assertIn("Example Source", agent_messages[1]["content"])

    def test_stream_execution_is_driven_by_langgraph(self):
        from agents import research_stream

        class FakeGraph:
            called = False

            async def astream(self, state, stream_mode=None):
                self.called = True
                self.state = dict(state)
                self.stream_mode = stream_mode
                yield {
                    "classify_intent": {
                        "intent": "direct_answer",
                        "reason": "test route",
                    }
                }
                yield {
                    "answer_direct": {
                        "answer": "LangGraph handled this.",
                        "result_type": "answer",
                        "report_completed": True,
                    }
                }

        fake_graph = FakeGraph()

        with (
            patch.object(research_stream, "research_agent", fake_graph, create=True),
            patch.object(
                research_stream,
                "classify_research_intent_node",
                side_effect=AssertionError("stream should use LangGraph, not the manual router"),
            ),
        ):
            events = asyncio.run(_collect_stream_events(research_stream.stream_research_events("test query")))

        self.assertTrue(fake_graph.called)
        self.assertEqual(fake_graph.stream_mode, "updates")
        complete_payload = json.loads(
            [event for event in events if event.startswith("event: complete")][0].split("data: ", 1)[1]
        )
        self.assertEqual(complete_payload["answer"], "LangGraph handled this.")

    def test_stream_resolves_follow_up_before_routing_and_search(self):
        from agents import research_stream

        classifier_states = []
        search_states = []

        async def fake_resolve_node(state):
            return {
                "resolved_query": "What is hasmokan's Codeforces rating?",
                "search_query": "hasmokan Codeforces rating",
                "context_resolution": {
                    "used_context": True,
                    "reason": "Resolved '他' from previous conversation context.",
                },
            }

        async def fake_classify_node(state):
            classifier_states.append(dict(state))
            return {"intent": "new_research", "reason": "needs current profile lookup"}

        async def fake_web_search_node(state):
            search_states.append(dict(state))
            return {
                "documents": [],
                "web_search_completed": True,
            }

        contextual_query = (
            "Use the previous conversation context only when it is necessary.\n\n"
            "Previous conversation context:\n"
            "user: 谁是hasmokan\n"
            "assistant: hasmokan 是一个 GitHub 用户。\n\n"
            "Current user request:\n"
            "所以他在 codeforce 上多少分"
        )

        with (
            patch.object(research_stream, "resolve_research_query_node", fake_resolve_node, create=True),
            patch.object(research_stream, "classify_research_intent_node", fake_classify_node),
            patch.object(research_stream, "web_search_node", fake_web_search_node),
        ):
            events = asyncio.run(
                _collect_stream_events(
                    research_stream.stream_research_events(
                        contextual_query,
                        display_query="所以他在 codeforce 上多少分",
                    )
                )
            )

        self.assertEqual(classifier_states[-1]["resolved_query"], "What is hasmokan's Codeforces rating?")
        self.assertEqual(search_states[-1]["search_query"], "hasmokan Codeforces rating")

        agent_messages = [
            json.loads(event.split("data: ", 1)[1])
            for event in events
            if event.startswith("event: agent_message")
        ]
        search_trace = [
            json.loads(event.split("data: ", 1)[1])
            for event in events
            if event.startswith("event: trace") and '"title":"Search web"' in event
        ][0]

        self.assertEqual(agent_messages[0]["tool_calls"][0]["args"]["query"], "hasmokan Codeforces rating")
        self.assertEqual(search_trace["query"], "hasmokan Codeforces rating")

    def test_coding_stream_forwards_sandbox_trace_events(self):
        from agents import research_stream

        async def fake_coding_node(state):
            yield {
                "type": "trace",
                "stage": "coding",
                "kind": "tool_call",
                "title": "Run command",
                "detail": "Calling sandbox tool: bash",
                "tool": "bash",
                "arguments": {"command": "python solution.py"},
            }
            yield {
                "type": "trace",
                "stage": "coding",
                "kind": "tool_result",
                "title": "Run command",
                "detail": "ok",
                "tool": "bash",
                "result": {"ok": True, "content": "ok"},
            }
            yield {"type": "answer_delta", "delta": "done"}
            yield {
                "type": "final",
                "state": {
                    "answer": "done",
                    "result_type": "answer",
                    "report_completed": True,
                },
            }

        with (
            patch.object(research_stream, "stream_answer_coding_node", fake_coding_node),
            patch.object(
                research_stream,
                "classify_research_intent_node",
                return_value={"intent": "coding_help", "reason": "test"},
            ),
        ):
            events = asyncio.run(_collect_stream_events(research_stream.stream_research_events("写代码")))

        trace_payloads = [
            json.loads(event.split("data: ", 1)[1])
            for event in events
            if event.startswith("event: trace")
        ]

        self.assertEqual(trace_payloads[0]["title"], "Route selected")
        self.assertEqual(trace_payloads[0]["route"], "answer_coding")
        self.assertEqual(trace_payloads[1]["kind"], "tool_call")
        self.assertEqual(trace_payloads[1]["tool"], "bash")
        self.assertEqual(trace_payloads[2]["kind"], "tool_result")
        self.assertEqual(trace_payloads[2]["result"]["content"], "ok")

    def test_stream_emits_llm_drafts_as_live_thinking_events(self):
        from agents import research_stream

        async def fake_web_search_node(state):
            return {
                "documents": [
                    {
                        "id": "web_0",
                        "content": "**Example Source**\n\nUseful source text.",
                        "metadata": {"title": "Example Source"},
                        "similarity": 1.0,
                    }
                ],
                "web_search_completed": True,
            }

        async def fake_analyze_node(state):
            yield {
                "type": "draft",
                "id": "analysis-draft",
                "stage": "analyze",
                "label": "Analysis draft",
                "text": "Partial analysis",
            }
            yield {
                "type": "draft",
                "id": "analysis-draft",
                "stage": "analyze",
                "label": "Analysis draft",
                "text": "Partial analysis done.",
            }
            yield {
                "type": "final",
                "state": {
                    "analysis": "Partial analysis done.",
                    "analysis_completed": True,
                },
            }

        async def fake_generate_node(state):
            yield {
                "type": "draft",
                "id": "report-draft",
                "stage": "report",
                "label": "Report draft",
                "text": "# Report",
            }
            yield {
                "type": "draft",
                "id": "report-draft",
                "stage": "report",
                "label": "Report draft",
                "text": "# Report\n\nFinal text.",
            }
            yield {
                "type": "final",
                "state": {
                    "report": "# Report\n\nFinal text.",
                    "report_completed": True,
                },
            }

        with (
            patch.object(
                research_stream,
                "classify_research_intent_node",
                return_value={"intent": "new_research", "reason": "test"},
            ),
            patch.object(research_stream, "web_search_node", fake_web_search_node),
            patch.object(research_stream, "stream_analyze_node", fake_analyze_node),
            patch.object(research_stream, "stream_generate_node", fake_generate_node),
        ):
            events = asyncio.run(_collect_stream_events(research_stream.stream_research_events("test query")))

        thinking_payloads = [
            json.loads(event.split("data: ", 1)[1])
            for event in events
            if event.startswith("event: thinking")
        ]

        self.assertEqual(
            [(payload["id"], payload["text"]) for payload in thinking_payloads],
            [
                ("analysis-draft", "Partial analysis"),
                ("analysis-draft", "Partial analysis done."),
                ("report-draft", "# Report"),
                ("report-draft", "# Report\n\nFinal text."),
            ],
        )

    def test_react_mode_streams_trace_events_and_answer_result(self):
        from agents import research_stream

        async def fake_react_messages(query):
            yield {
                "type": "agent_message",
                "message": {
                    "type": "ai",
                    "id": "ai-1",
                    "content": "",
                    "reasoning_content": "Need a current source.",
                    "tool_calls": [
                        {
                            "id": "call-1",
                            "name": "web_search",
                            "args": {"query": query},
                        }
                    ],
                },
            }
            yield {
                "type": "agent_message",
                "message": {
                    "type": "tool",
                    "id": "tool-call-1",
                    "tool_call_id": "call-1",
                    "name": "web_search",
                    "content": '[{"title":"Example Source","url":"https://example.com"}]',
                },
            }
            yield {
                "type": "final",
                "answer": "Here is the sourced answer.",
            }

        with (
            patch.object(
                research_stream,
                "classify_research_intent_node",
                return_value={"intent": "new_research", "reason": "test"},
            ),
            patch.object(research_stream, "stream_react_agent_messages", fake_react_messages),
        ):
            events = asyncio.run(
                _collect_stream_events(
                    research_stream.stream_research_events(
                        "test query",
                        execution_mode="react",
                    )
                )
            )

        event_names = [event.split("\n", 1)[0] for event in events]
        self.assertIn("event: agent_message", event_names)
        self.assertIn("event: answer", event_names)
        self.assertIn("event: complete", event_names)
        trace_payloads = [
            json.loads(event.split("data: ", 1)[1])
            for event in events
            if event.startswith("event: trace")
        ]
        self.assertEqual(trace_payloads[0]["title"], "Route selected")
        self.assertEqual(trace_payloads[0]["route"], "web_search")
        self.assertEqual(trace_payloads[1]["stage"], "react")
        self.assertEqual(trace_payloads[1]["title"], "Run ReAct agent")
        self.assertEqual(
            [(payload["kind"], payload["title"]) for payload in trace_payloads[2:]],
            [
                ("reasoning", "Thinking"),
                ("tool_call", "Search web"),
                ("tool_result", "Sources found"),
            ],
        )
        self.assertEqual(trace_payloads[2]["detail"], "Need a current source.")
        self.assertEqual(trace_payloads[3]["detail"], "test query")
        self.assertEqual(trace_payloads[4]["documents"][0]["title"], "Example Source")

        complete_payload = json.loads(
            [event for event in events if event.startswith("event: complete")][0].split("data: ", 1)[1]
        )
        self.assertEqual(complete_payload["answer"], "Here is the sourced answer.")
        self.assertEqual(complete_payload["result_type"], "answer")
        self.assertEqual(complete_payload["status"], "completed")

    def test_stream_route_returns_text_event_stream(self):
        from agents.research_stream import format_sse_event
        from routers import research

        async def fake_stream(query, run_id=None, display_query=None, store=None, on_complete=None):
            yield format_sse_event("status", {"stage": "search", "message": query})
            yield format_sse_event("complete", {"query": query, "status": "completed"})

        async def fake_persisted_stream(run_id, user_id, store=None):
            yield format_sse_event("status", {"stage": "search", "message": "test query"})
            yield format_sse_event("complete", {"query": "test query", "status": "completed"})

        client = TestClient(app)

        with patch.object(research.research_run_store, "create_run", return_value={
            "run_id": "run-test",
            "query": "test query",
            "status": "running",
            "created_at": "2026-05-17T00:00:00+00:00",
            "updated_at": "2026-05-17T00:00:00+00:00",
        }):
            with patch.object(research.research_run_store, "append_event"):
                with (
                    patch.object(research, "stream_research_events", fake_stream),
                    patch.object(research, "stream_persisted_research_run_events", side_effect=fake_persisted_stream),
                ):
                    response = client.get("/api/research/stream?query=test%20query")

        self.assertEqual(response.status_code, 200)
        self.assertIn("text/event-stream", response.headers["content-type"])
        self.assertIn("event: status", response.text)
        self.assertIn('"message":"test query"', response.text)
        self.assertIn("event: complete", response.text)

    def test_stream_route_emits_metadata_event_with_run_id(self):
        from agents.research_stream import format_sse_event
        from routers import research

        async def fake_persisted_stream(run_id, user_id, store=None):
            yield format_sse_event("metadata", {"run_id": run_id})
            yield format_sse_event("complete", {"query": "test query", "status": "completed"})

        client = TestClient(app)

        with patch.object(research.research_run_store, "create_run", return_value={
            "run_id": "run-test",
            "query": "test query",
            "status": "running",
            "created_at": "2026-05-17T00:00:00+00:00",
            "updated_at": "2026-05-17T00:00:00+00:00",
        }):
            with patch.object(research.research_run_store, "append_event"):
                with (
                    patch.object(research, "stream_research_events") as stream,
                    patch.object(research, "stream_persisted_research_run_events", side_effect=fake_persisted_stream),
                ):
                    async def fake_stream(query, run_id=None, display_query=None, store=None, on_complete=None):
                        self.assertEqual(run_id, "run-test")
                        yield 'event: complete\ndata: {"query":"test query","status":"completed"}\n\n'

                    stream.side_effect = fake_stream
                    response = client.get("/api/research/stream?query=test%20query")

        self.assertEqual(response.status_code, 200)
        self.assertIn('event: metadata\ndata: {"run_id":"run-test"}', response.text)

    def test_post_stream_route_starts_background_run_and_subscribes_to_persisted_events(self):
        from agents.research_stream import format_sse_event
        from routers import research

        async def fake_persisted_stream(run_id, user_id, store=None):
            yield format_sse_event("metadata", {"run_id": run_id})
            yield format_sse_event("complete", {"query": "test query", "status": "completed"})

        async def unused_live_stream(query, run_id=None, display_query=None, store=None, latest_result=None, on_complete=None):
            yield format_sse_event("stream_error", {"detail": "live stream should not be used"})

        client = TestClient(app)

        with patch.object(research.research_run_store, "create_run", return_value={
            "run_id": "run-test",
            "query": "test query",
            "status": "running",
            "created_at": "2026-05-17T00:00:00+00:00",
            "updated_at": "2026-05-17T00:00:00+00:00",
        }):
            with (
                patch.object(research, "start_research_run_background", create=True) as start_background,
                patch.object(
                    research,
                    "stream_persisted_research_run_events",
                    side_effect=fake_persisted_stream,
                    create=True,
                ),
                patch.object(research, "stream_research_events", unused_live_stream),
            ):
                response = client.post("/api/research/stream", json={"query": "test query"})

        self.assertEqual(response.status_code, 200)
        self.assertIn("event: metadata", response.text)
        self.assertIn("event: complete", response.text)
        self.assertEqual(start_background.call_count, 1)

    def test_run_stream_route_replays_persisted_events(self):
        from routers import research

        client = TestClient(app)

        with patch.object(research.research_run_store, "get_run", return_value={
            "run_id": "run-test",
            "query": "test query",
            "status": "completed",
            "created_at": "2026-05-17T00:00:00+00:00",
            "updated_at": "2026-05-17T00:00:01+00:00",
            "events": [
                {"event": "metadata", "data": {"run_id": "run-test"}, "seq": 1},
                {"event": "status", "data": {"stage": "search", "message": "Searching"}, "seq": 2},
                {"event": "complete", "data": {"query": "test query", "status": "completed"}, "seq": 3},
            ],
        }):
            response = client.get("/api/research/runs/run-test/stream")

        self.assertEqual(response.status_code, 200)
        self.assertIn("text/event-stream", response.headers["content-type"])
        self.assertIn("event: status", response.text)
        self.assertIn('"message":"Searching"', response.text)
        self.assertIn("event: complete", response.text)

    def test_get_run_route_returns_persisted_events(self):
        from routers import research

        client = TestClient(app)

        with patch.object(research.research_run_store, "get_run", return_value={
            "run_id": "run-test",
            "query": "test query",
            "status": "completed",
            "created_at": "2026-05-17T00:00:00+00:00",
            "updated_at": "2026-05-17T00:00:01+00:00",
            "events": [
                {"event": "metadata", "data": {"run_id": "run-test"}},
                {"event": "complete", "data": {"status": "completed"}},
            ],
        }):
            response = client.get("/api/research/runs/run-test")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["run_id"], "run-test")
        self.assertEqual(response.json()["events"][1]["event"], "complete")


async def _collect_stream_events(stream):
    return [event async for event in stream]


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
