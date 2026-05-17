"""SSE stream behavior for research execution."""

import asyncio
import json
from unittest import TestCase
from unittest.mock import patch

from fastapi.testclient import TestClient

from main import app


class ResearchStreamTests(TestCase):
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

        self.assertEqual(trace_payloads[0]["kind"], "tool_call")
        self.assertEqual(trace_payloads[0]["title"], "Search web")
        self.assertEqual(trace_payloads[1]["kind"], "tool_result")
        self.assertEqual(trace_payloads[1]["documents"][0]["title"], "Example Source")
        self.assertEqual(trace_payloads[1]["documents"][0]["url"], "https://example.com/source")
        thinking_payloads = [
            json.loads(event.split("data: ", 1)[1])
            for event in events
            if event.startswith("event: thinking")
        ]
        self.assertEqual(thinking_payloads[0]["id"], "analysis-thinking")
        self.assertEqual(thinking_payloads[0]["text"], "Reading the source.")
        self.assertEqual(thinking_payloads[1]["id"], "report-thinking")
        self.assertEqual(thinking_payloads[1]["text"], "Drafting the report.")

    def test_stream_route_returns_text_event_stream(self):
        from agents.research_stream import format_sse_event
        from routers import research

        async def fake_stream(query, run_id=None, display_query=None, store=None):
            yield format_sse_event("status", {"stage": "search", "message": query})
            yield format_sse_event("complete", {"query": query, "status": "completed"})

        client = TestClient(app)

        with patch.object(research.research_run_store, "create_run", return_value={
            "run_id": "run-test",
            "query": "test query",
            "status": "running",
            "created_at": "2026-05-17T00:00:00+00:00",
            "updated_at": "2026-05-17T00:00:00+00:00",
        }):
            with patch.object(research.research_run_store, "append_event"):
                with patch.object(research, "stream_research_events", fake_stream):
                    response = client.get("/api/research/stream?query=test%20query")

        self.assertEqual(response.status_code, 200)
        self.assertIn("text/event-stream", response.headers["content-type"])
        self.assertIn("event: status", response.text)
        self.assertIn('"message":"test query"', response.text)
        self.assertIn("event: complete", response.text)

    def test_stream_route_emits_metadata_event_with_run_id(self):
        from routers import research

        client = TestClient(app)

        with patch.object(research.research_run_store, "create_run", return_value={
            "run_id": "run-test",
            "query": "test query",
            "status": "running",
            "created_at": "2026-05-17T00:00:00+00:00",
            "updated_at": "2026-05-17T00:00:00+00:00",
        }):
            with patch.object(research.research_run_store, "append_event"):
                with patch.object(research, "stream_research_events") as stream:
                    async def fake_stream(query, run_id=None, display_query=None, store=None):
                        self.assertEqual(run_id, "run-test")
                        yield 'event: complete\ndata: {"query":"test query","status":"completed"}\n\n'

                    stream.side_effect = fake_stream
                    response = client.get("/api/research/stream?query=test%20query")

        self.assertEqual(response.status_code, 200)
        self.assertIn('event: metadata\ndata: {"run_id":"run-test"}', response.text)

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
