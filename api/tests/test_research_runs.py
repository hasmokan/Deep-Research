"""Persistent research run event storage."""

from unittest import TestCase
from tempfile import TemporaryDirectory


class ResearchRunStoreTests(TestCase):
    def test_jsonl_store_creates_run_and_appends_events(self):
        from services.research_runs import JsonlResearchRunStore

        with TemporaryDirectory() as tmpdir:
            store = JsonlResearchRunStore(tmpdir)

            run = store.create_run("青稞市场占有率", user_id="user-1")
            store.append_event(run["run_id"], "status", {"stage": "search"})
            store.append_event(run["run_id"], "complete", {"status": "completed"})

            restored = store.get_run(run["run_id"], user_id="user-1")
            hidden = store.get_run(run["run_id"], user_id="user-2")

        self.assertIsNotNone(restored)
        self.assertIsNone(hidden)
        assert restored is not None
        self.assertEqual(restored["user_id"], "user-1")
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

            run = store.create_run("青稞市场占有率", user_id="user-1")
            store.append_event(run["run_id"], "stream_error", {"detail": "boom"})

            restored = store.get_run(run["run_id"], user_id="user-1")

        self.assertIsNotNone(restored)
        assert restored is not None
        self.assertEqual(restored["status"], "failed")

    def test_jsonl_store_marks_stopped_runs(self):
        from services.research_runs import JsonlResearchRunStore

        with TemporaryDirectory() as tmpdir:
            store = JsonlResearchRunStore(tmpdir)

            run = store.create_run("青稞市场占有率", user_id="user-1")
            store.append_event(run["run_id"], "stopped", {"status": "stopped"})

            restored = store.get_run(run["run_id"], user_id="user-1")

        self.assertIsNotNone(restored)
        assert restored is not None
        self.assertEqual(restored["status"], "stopped")

    def test_supabase_store_creates_run_and_appends_events(self):
        from services.research_runs import SupabaseResearchRunStore

        client = FakeSupabaseClient()
        store = SupabaseResearchRunStore(client)

        run = store.create_run("青稞市场占有率", user_id="user-1")
        store.append_event(run["run_id"], "status", {"stage": "search"})
        store.append_event(run["run_id"], "complete", {"status": "completed"})

        restored = store.get_run(run["run_id"], user_id="user-1")
        hidden = store.get_run(run["run_id"], user_id="user-2")

        self.assertIsNotNone(restored)
        self.assertIsNone(hidden)
        assert restored is not None
        self.assertEqual(restored["user_id"], "user-1")
        self.assertEqual(restored["query"], "青稞市场占有率")
        self.assertEqual(restored["status"], "completed")
        self.assertEqual(
            [event["event"] for event in restored["events"]],
            ["metadata", "status", "complete"],
        )
        self.assertEqual(restored["events"][0]["data"]["run_id"], run["run_id"])


class FakeSupabaseResponse:
    def __init__(self, data):
        self.data = data


class FakeSupabaseClient:
    def __init__(self):
        self.tables = {}

    def table(self, table_name):
        return FakeSupabaseTable(self.tables.setdefault(table_name, []), table_name)


class FakeSupabaseTable:
    def __init__(self, rows, table_name):
        self.rows = rows
        self.table_name = table_name
        self.operation = "select"
        self.payload = None
        self.filters = []
        self.order_by = None
        self.order_desc = False
        self.limit_count = None

    def select(self, _columns):
        self.operation = "select"
        return self

    def insert(self, payload):
        self.operation = "insert"
        self.payload = payload
        return self

    def update(self, payload):
        self.operation = "update"
        self.payload = payload
        return self

    def eq(self, key, value):
        self.filters.append((key, value))
        return self

    def order(self, key, desc=False):
        self.order_by = key
        self.order_desc = desc
        return self

    def limit(self, count):
        self.limit_count = count
        return self

    def execute(self):
        if self.operation == "insert":
            row = dict(self.payload)
            if self.table_name == "research_run_events" and "id" not in row:
                row["id"] = len(self.rows) + 1
            self.rows.append(row)
            return FakeSupabaseResponse([row])

        if self.operation == "update":
            updated = []
            for row in self._filtered_rows():
                row.update(dict(self.payload))
                updated.append(dict(row))
            return FakeSupabaseResponse(updated)

        data = [dict(row) for row in self._filtered_rows()]
        if self.order_by:
            data = sorted(data, key=lambda row: row.get(self.order_by) or "", reverse=self.order_desc)
        if self.limit_count is not None:
            data = data[:self.limit_count]
        return FakeSupabaseResponse(data)

    def _filtered_rows(self):
        return [
            row
            for row in self.rows
            if all(row.get(key) == value for key, value in self.filters)
        ]
