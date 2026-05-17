"""Persistent research thread storage."""

from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

from fastapi.testclient import TestClient

from main import app


class ResearchThreadStoreTests(TestCase):
    def test_json_store_upserts_and_lists_threads(self):
        from services.research_threads import JsonResearchThreadStore

        with TemporaryDirectory() as tmpdir:
            store = JsonResearchThreadStore(tmpdir)

            thread = store.upsert_thread(
                "thread-1",
                title="青稞市场",
                messages=[{"role": "user", "content": "查青稞"}],
            )
            restored = store.get_thread("thread-1")
            threads = store.list_threads()

        self.assertEqual(thread["thread_id"], "thread-1")
        self.assertIsNotNone(restored)
        assert restored is not None
        self.assertEqual(restored["title"], "青稞市场")
        self.assertEqual(restored["messages"][0]["content"], "查青稞")
        self.assertEqual(threads[0]["thread_id"], "thread-1")


class ResearchThreadRouteTests(TestCase):
    def test_thread_routes_save_and_return_thread(self):
        from routers import research

        client = TestClient(app)

        with TemporaryDirectory() as tmpdir:
            from services.research_threads import JsonResearchThreadStore

            store = JsonResearchThreadStore(tmpdir)
            with patch.object(research, "research_thread_store", store):
                save_response = client.put(
                    "/api/research/threads/thread-1",
                    json={
                        "title": "青稞市场",
                        "messages": [{"role": "user", "content": "查青稞"}],
                    },
                )
                get_response = client.get("/api/research/threads/thread-1")
                list_response = client.get("/api/research/threads")

        self.assertEqual(save_response.status_code, 200)
        self.assertEqual(get_response.status_code, 200)
        self.assertEqual(get_response.json()["title"], "青稞市场")
        self.assertEqual(list_response.json()[0]["thread_id"], "thread-1")

