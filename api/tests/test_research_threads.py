"""Persistent research thread storage."""

from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

from fastapi.testclient import TestClient

from main import app
from services.auth import AuthenticatedUser, get_current_user


class ResearchThreadStoreTests(TestCase):
    def test_json_store_upserts_and_lists_threads(self):
        from services.research_threads import JsonResearchThreadStore

        with TemporaryDirectory() as tmpdir:
            store = JsonResearchThreadStore(tmpdir)

            thread = store.upsert_thread(
                "user-1",
                "thread-1",
                title="青稞市场",
                messages=[{"role": "user", "content": "查青稞"}],
            )
            store.upsert_thread(
                "user-2",
                "thread-2",
                title="竞品分析",
                messages=[{"role": "user", "content": "查竞品"}],
            )
            restored = store.get_thread("user-1", "thread-1")
            threads = store.list_threads("user-1")

        self.assertEqual(thread["thread_id"], "thread-1")
        self.assertEqual(thread["user_id"], "user-1")
        self.assertIsNotNone(restored)
        assert restored is not None
        self.assertEqual(restored["title"], "青稞市场")
        self.assertEqual(restored["messages"][0]["content"], "查青稞")
        self.assertEqual([item["thread_id"] for item in threads], ["thread-1"])

    def test_supabase_store_upserts_and_lists_threads(self):
        from services.research_threads import SupabaseResearchThreadStore

        client = FakeSupabaseClient()
        store = SupabaseResearchThreadStore(client)

        thread = store.upsert_thread(
            "user-1",
            "thread-1",
            title="青稞市场",
            messages=[{"role": "user", "content": "查青稞"}],
        )
        store.upsert_thread(
            "user-2",
            "thread-2",
            title="竞品分析",
            messages=[{"role": "user", "content": "查竞品"}],
        )
        restored = store.get_thread("user-1", "thread-1")
        threads = store.list_threads("user-1")

        self.assertEqual(thread["thread_id"], "thread-1")
        self.assertEqual(thread["user_id"], "user-1")
        self.assertIsNotNone(restored)
        assert restored is not None
        self.assertEqual(restored["title"], "青稞市场")
        self.assertEqual(restored["messages"][0]["content"], "查青稞")
        self.assertEqual([item["thread_id"] for item in threads], ["thread-1"])


class ResearchThreadRouteTests(TestCase):
    def test_thread_routes_require_authentication(self):
        client = TestClient(app)

        list_response = client.get("/api/research/threads")

        self.assertEqual(list_response.status_code, 401)

    def test_thread_routes_are_scoped_to_current_user(self):
        from routers import research
        from services.research_threads import JsonResearchThreadStore

        client = TestClient(app)

        with TemporaryDirectory() as tmpdir:
            research.research_thread_store = JsonResearchThreadStore(tmpdir)
            app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(user_id="user-1")
            try:
                save_response = client.put(
                    "/api/research/threads/thread-1",
                    json={
                        "title": "青稞市场",
                        "messages": [{"role": "user", "content": "查青稞"}],
                    },
                )
                list_response = client.get("/api/research/threads")

                app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(user_id="user-2")
                other_list_response = client.get("/api/research/threads")
            finally:
                app.dependency_overrides.clear()

        self.assertEqual(save_response.status_code, 200)
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(other_list_response.status_code, 200)
        self.assertEqual(list_response.json()[0]["thread_id"], "thread-1")
        self.assertEqual(other_list_response.json(), [])


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
        self.on_conflict = None

    def select(self, _columns):
        self.operation = "select"
        return self

    def upsert(self, payload, on_conflict=None):
        self.operation = "upsert"
        self.payload = payload
        self.on_conflict = on_conflict
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
        if self.operation == "upsert":
            conflict_keys = (self.on_conflict or _primary_key_for(self.table_name)).split(",")
            existing = next((
                row
                for row in self.rows
                if all(row.get(key) == self.payload.get(key) for key in conflict_keys)
            ), None)
            if existing is None:
                self.rows.append(dict(self.payload))
                return FakeSupabaseResponse([self.rows[-1]])

            existing.update(dict(self.payload))
            return FakeSupabaseResponse([existing])

        data = [row for row in self.rows if all(row.get(key) == value for key, value in self.filters)]
        if self.order_by:
            data = sorted(data, key=lambda row: row.get(self.order_by) or "", reverse=self.order_desc)
        if self.limit_count is not None:
            data = data[:self.limit_count]
        return FakeSupabaseResponse([dict(row) for row in data])


def _primary_key_for(table_name):
    return {
        "research_threads": "thread_id",
    }.get(table_name, "id")
