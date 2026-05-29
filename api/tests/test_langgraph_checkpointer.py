"""LangGraph checkpointer configuration."""

from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from langgraph.checkpoint.memory import MemorySaver


class LangGraphCheckpointerTests(TestCase):
    def tearDown(self):
        from services.langgraph_checkpointer import close_langgraph_checkpointers

        close_langgraph_checkpointers()

    def test_memory_backend_uses_in_process_saver_by_default(self):
        from services.langgraph_checkpointer import create_langgraph_checkpointer

        checkpointer = create_langgraph_checkpointer(
            SimpleNamespace(
                langgraph_checkpoint_backend="memory",
                langgraph_checkpoint_postgres_url=None,
                langgraph_checkpoint_setup=True,
            )
        )

        self.assertIsInstance(checkpointer, MemorySaver)

    def test_postgres_backend_requires_connection_url(self):
        from services.langgraph_checkpointer import create_langgraph_checkpointer

        with self.assertRaisesRegex(ValueError, "LANGGRAPH_CHECKPOINT_POSTGRES_URL"):
            create_langgraph_checkpointer(
                SimpleNamespace(
                    langgraph_checkpoint_backend="postgres",
                    langgraph_checkpoint_postgres_url=None,
                    langgraph_checkpoint_setup=True,
                )
            )

    def test_postgres_backend_enters_context_and_runs_setup(self):
        from services.langgraph_checkpointer import create_langgraph_checkpointer

        calls = []
        fake_saver = FakePostgresSaver(calls)

        class FakeContext:
            def __enter__(self):
                calls.append(("enter",))
                return fake_saver

            def __exit__(self, exc_type, exc, traceback):
                calls.append(("exit", exc_type, exc, traceback))

        class FakePostgresSaverFactory:
            @classmethod
            def from_conn_string(cls, url):
                calls.append(("from_conn_string", url))
                return FakeContext()

        with patch(
            "services.langgraph_checkpointer._load_postgres_saver",
            return_value=FakePostgresSaverFactory,
        ):
            checkpointer = create_langgraph_checkpointer(
                SimpleNamespace(
                    langgraph_checkpoint_backend="postgres",
                    langgraph_checkpoint_postgres_url="postgresql://example/checkpoints",
                    langgraph_checkpoint_setup=True,
                )
            )

        self.assertIs(checkpointer, fake_saver)
        self.assertEqual(
            calls,
            [
                ("from_conn_string", "postgresql://example/checkpoints"),
                ("enter",),
                ("setup",),
            ],
        )

    def test_postgres_backend_closes_context_when_setup_fails(self):
        from services.langgraph_checkpointer import create_langgraph_checkpointer

        calls = []
        fake_saver = FailingPostgresSaver(calls)

        class FakeContext:
            def __enter__(self):
                calls.append(("enter",))
                return fake_saver

            def __exit__(self, exc_type, exc, traceback):
                calls.append(("exit", exc_type.__name__ if exc_type else None))

        class FakePostgresSaverFactory:
            @classmethod
            def from_conn_string(cls, url):
                calls.append(("from_conn_string", url))
                return FakeContext()

        with patch(
            "services.langgraph_checkpointer._load_postgres_saver",
            return_value=FakePostgresSaverFactory,
        ):
            with self.assertRaisesRegex(RuntimeError, "setup failed"):
                create_langgraph_checkpointer(
                    SimpleNamespace(
                        langgraph_checkpoint_backend="postgres",
                        langgraph_checkpoint_postgres_url="postgresql://example/checkpoints",
                        langgraph_checkpoint_setup=True,
                    )
                )

        self.assertEqual(
            calls,
            [
                ("from_conn_string", "postgresql://example/checkpoints"),
                ("enter",),
                ("setup",),
                ("exit", "RuntimeError"),
            ],
        )


class FakePostgresSaver:
    def __init__(self, calls):
        self._calls = calls

    def setup(self):
        self._calls.append(("setup",))
        return None


class FailingPostgresSaver(FakePostgresSaver):
    def setup(self):
        self._calls.append(("setup",))
        raise RuntimeError("setup failed")
