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
