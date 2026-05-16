"""SSE stream behavior for research execution."""

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

    def test_stream_route_returns_text_event_stream(self):
        from agents.research_stream import format_sse_event
        from routers import research

        async def fake_stream(query):
            yield format_sse_event("status", {"stage": "search", "message": query})
            yield format_sse_event("complete", {"query": query, "status": "completed"})

        client = TestClient(app)

        with patch.object(research, "stream_research_events", fake_stream):
            response = client.get("/api/research/stream?query=test%20query")

        self.assertEqual(response.status_code, 200)
        self.assertIn("text/event-stream", response.headers["content-type"])
        self.assertIn("event: status", response.text)
        self.assertIn('"message":"test query"', response.text)
        self.assertIn("event: complete", response.text)
