"""Request tracing and client diagnostics behavior."""

from __future__ import annotations

from tempfile import TemporaryDirectory
from unittest import TestCase

from fastapi.testclient import TestClient

from main import app
from services.auth import AuthenticatedUser, get_current_user


class RequestTracingTests(TestCase):
    def tearDown(self):
        app.dependency_overrides.clear()

    def test_health_echoes_request_id_header(self):
        client = TestClient(app)

        response = client.get("/health", headers={"X-Request-ID": "trace-test-123"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("X-Request-ID"), "trace-test-123")

    def test_client_error_endpoint_logs_user_and_trace_context(self):
        app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(user_id="user-1")
        client = TestClient(app)

        with self.assertLogs("deep_research", level="ERROR") as captured:
            response = client.post(
                "/api/diagnostics/client-error",
                headers={"X-Request-ID": "trace-client-123"},
                json={
                    "message": "Rendered report failed",
                    "source": "window.onerror",
                    "level": "error",
                    "url": "http://localhost:3000/research",
                    "run_id": "run-123",
                    "context": {"component": "ReportSidebar"},
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("X-Request-ID"), "trace-client-123")
        self.assertEqual(response.json()["request_id"], "trace-client-123")

        payloads = [
            getattr(record, "event_payload", {})
            for record in captured.records
            if getattr(record, "event_payload", {}).get("event") == "client_error"
        ]
        self.assertTrue(payloads)
        self.assertEqual(payloads[0]["event"], "client_error")
        self.assertEqual(payloads[0]["request_id"], "trace-client-123")
        self.assertEqual(payloads[0]["user_id"], "user-1")
        self.assertEqual(payloads[0]["run_id"], "run-123")


class ResearchRunTracingTests(TestCase):
    def test_jsonl_run_metadata_includes_current_trace_id(self):
        from services.request_tracing import reset_request_id, set_request_id
        from services.research_runs import JsonlResearchRunStore

        with TemporaryDirectory() as tmpdir:
            store = JsonlResearchRunStore(tmpdir)
            token = set_request_id("trace-run-123")
            try:
                run = store.create_run("traceable query", user_id="user-1")
            finally:
                reset_request_id(token)

            restored = store.get_run(run["run_id"], user_id="user-1")

        self.assertEqual(run["trace_id"], "trace-run-123")
        self.assertIsNotNone(restored)
        assert restored is not None
        self.assertEqual(restored["trace_id"], "trace-run-123")
        self.assertEqual(restored["events"][0]["data"]["trace_id"], "trace-run-123")
