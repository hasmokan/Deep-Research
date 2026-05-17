"""Persistent research run event storage."""

from unittest import TestCase
from tempfile import TemporaryDirectory


class ResearchRunStoreTests(TestCase):
    def test_jsonl_store_creates_run_and_appends_events(self):
        from services.research_runs import JsonlResearchRunStore

        with TemporaryDirectory() as tmpdir:
            store = JsonlResearchRunStore(tmpdir)

            run = store.create_run("青稞市场占有率")
            store.append_event(run["run_id"], "status", {"stage": "search"})
            store.append_event(run["run_id"], "complete", {"status": "completed"})

            restored = store.get_run(run["run_id"])

        self.assertIsNotNone(restored)
        assert restored is not None
        self.assertEqual(restored["query"], "青稞市场占有率")
        self.assertEqual(restored["status"], "completed")
        self.assertEqual(
            [event["event"] for event in restored["events"]],
            ["metadata", "status", "complete"],
        )
        self.assertEqual(restored["events"][0]["data"]["run_id"], run["run_id"])

    def test_jsonl_store_marks_failed_runs_from_stream_error(self):
        from services.research_runs import JsonlResearchRunStore

        with TemporaryDirectory() as tmpdir:
            store = JsonlResearchRunStore(tmpdir)

            run = store.create_run("青稞市场占有率")
            store.append_event(run["run_id"], "stream_error", {"detail": "boom"})

            restored = store.get_run(run["run_id"])

        self.assertIsNotNone(restored)
        assert restored is not None
        self.assertEqual(restored["status"], "failed")

    def test_jsonl_store_marks_stopped_runs(self):
        from services.research_runs import JsonlResearchRunStore

        with TemporaryDirectory() as tmpdir:
            store = JsonlResearchRunStore(tmpdir)

            run = store.create_run("青稞市场占有率")
            store.append_event(run["run_id"], "stopped", {"status": "stopped"})

            restored = store.get_run(run["run_id"])

        self.assertIsNotNone(restored)
        assert restored is not None
        self.assertEqual(restored["status"], "stopped")
