"""Tests for configurable chat model selection."""

import asyncio
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import AsyncMock, patch

from core.config import get_settings
from models.schemas import ResearchRequest


EXPECTED_MODEL = "minimax/minimax-m2.7"
EXPECTED_EMBEDDING_MODEL = "openai/text-embedding-3-small"


class _FakePrompt:
    def __or__(self, llm):
        return _FakeChain()


class _FakeChain:
    response = SimpleNamespace(content="ok", additional_kwargs={})
    stream_chunks = []
    seen_payloads = []

    async def ainvoke(self, payload):
        self.seen_payloads.append(payload)
        return self.response

    async def astream(self, payload):
        self.seen_payloads.append(payload)
        for chunk in self.stream_chunks:
            yield chunk


class LlmModelSettingsTests(TestCase):
    def tearDown(self):
        get_settings.cache_clear()

    def test_default_llm_model_is_minimax_m27(self):
        with patch.dict(
            "os.environ",
            {
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_KEY": "service-key",
                "OPENAI_API_KEY": "api-key",
            },
            clear=True,
        ):
            get_settings.cache_clear()

            settings = get_settings()

        self.assertEqual(settings.llm_model, EXPECTED_MODEL)

    def test_default_embedding_model_uses_provider_prefixed_name(self):
        with patch.dict(
            "os.environ",
            {
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_KEY": "service-key",
                "OPENAI_API_KEY": "api-key",
            },
            clear=True,
        ):
            get_settings.cache_clear()

            settings = get_settings()

        self.assertEqual(settings.embedding_model, EXPECTED_EMBEDDING_MODEL)


class LlmNodeModelTests(TestCase):
    def setUp(self):
        _FakeChain.response = SimpleNamespace(content="ok", additional_kwargs={})
        _FakeChain.stream_chunks = []
        _FakeChain.seen_payloads = []

    def test_analyze_node_uses_configured_llm_model(self):
        from agents.nodes import analyze

        fake_settings = SimpleNamespace(
            openai_api_key="api-key",
            openai_base_url="https://api.example.test/v1",
            llm_model=EXPECTED_MODEL,
        )

        with (
            patch.object(analyze, "settings", fake_settings),
            patch.object(analyze.ChatPromptTemplate, "from_messages", return_value=_FakePrompt()),
            patch.object(analyze, "ChatOpenAI") as chat_openai,
        ):
            asyncio.run(
                analyze.analyze_node(
                    {
                        "query": "test query",
                        "documents": [{"content": "test document", "similarity": 0.99}],
                    }
                )
            )

        chat_openai.assert_called_once_with(
            model=EXPECTED_MODEL,
            temperature=0.3,
            api_key="api-key",
            base_url="https://api.example.test/v1",
            extra_body={"reasoning_split": True},
        )

    def test_analyze_node_returns_reasoning_details_separately(self):
        from agents.nodes import analyze

        _FakeChain.response = SimpleNamespace(
            content="analysis answer",
            additional_kwargs={"reasoning_details": [{"type": "text", "text": "analysis thinking"}]},
        )
        fake_settings = SimpleNamespace(
            openai_api_key="api-key",
            openai_base_url="https://api.example.test/v1",
            llm_model=EXPECTED_MODEL,
        )

        with (
            patch.object(analyze, "settings", fake_settings),
            patch.object(analyze.ChatPromptTemplate, "from_messages", return_value=_FakePrompt()),
            patch.object(analyze, "ChatOpenAI"),
        ):
            result = asyncio.run(
                analyze.analyze_node(
                    {
                        "query": "test query",
                        "documents": [{"content": "test document", "similarity": 0.99}],
                    }
                )
            )

        self.assertEqual(result["analysis"], "analysis answer")
        self.assertEqual(result["analysis_thinking"], "analysis thinking")

    def test_analyze_node_uses_resolved_query_when_available(self):
        from agents.nodes import analyze

        with (
            patch.object(analyze.ChatPromptTemplate, "from_messages", return_value=_FakePrompt()),
            patch.object(analyze, "ChatOpenAI"),
        ):
            asyncio.run(
                analyze.analyze_node(
                    {
                        "query": "Previous conversation context: user: 谁是hasmokan",
                        "resolved_query": "hasmokan Codeforces rating",
                        "documents": [{"content": "test document", "similarity": 0.99}],
                    }
                )
            )

        self.assertEqual(_FakeChain.seen_payloads[-1]["query"], "hasmokan Codeforces rating")

    def test_stream_analyze_node_yields_reasoning_content_deltas(self):
        from agents.nodes import analyze

        _FakeChain.stream_chunks = [
            SimpleNamespace(content="", additional_kwargs={"reasoning_content": "reading source"}),
            SimpleNamespace(content="analysis answer", additional_kwargs={}),
        ]
        fake_settings = SimpleNamespace(
            openai_api_key="api-key",
            openai_base_url="https://api.example.test/v1",
            llm_model=EXPECTED_MODEL,
        )

        with (
            patch.object(analyze, "settings", fake_settings),
            patch.object(analyze.ChatPromptTemplate, "from_messages", return_value=_FakePrompt()),
            patch.object(analyze, "ChatOpenAI"),
        ):
            events = asyncio.run(_collect_async_events(analyze.stream_analyze_node({
                "query": "test query",
                "documents": [{"content": "test document", "similarity": 0.99}],
            })))

        self.assertEqual(events[0]["type"], "thinking")
        self.assertEqual(events[0]["id"], "analysis-thinking")
        self.assertEqual(events[0]["text"], "reading source")
        self.assertEqual(events[1]["type"], "final")
        self.assertEqual(events[1]["state"]["analysis"], "analysis answer")
        self.assertEqual(events[1]["state"]["analysis_thinking"], "reading source")

    def test_stream_analyze_node_yields_visible_draft_content_deltas(self):
        from agents.nodes import analyze

        _FakeChain.stream_chunks = [
            SimpleNamespace(content="first ", additional_kwargs={}),
            SimpleNamespace(content="second", additional_kwargs={}),
        ]
        fake_settings = SimpleNamespace(
            openai_api_key="api-key",
            openai_base_url="https://api.example.test/v1",
            llm_model=EXPECTED_MODEL,
        )

        with (
            patch.object(analyze, "settings", fake_settings),
            patch.object(analyze.ChatPromptTemplate, "from_messages", return_value=_FakePrompt()),
            patch.object(analyze, "ChatOpenAI"),
        ):
            events = asyncio.run(_collect_async_events(analyze.stream_analyze_node({
                "query": "test query",
                "documents": [{"content": "test document", "similarity": 0.99}],
            })))

        self.assertEqual(events[0]["type"], "draft")
        self.assertEqual(events[0]["id"], "analysis-draft")
        self.assertEqual(events[0]["text"], "first")
        self.assertEqual(events[1]["type"], "draft")
        self.assertEqual(events[1]["text"], "first second")
        self.assertEqual(events[2]["type"], "final")
        self.assertEqual(events[2]["state"]["analysis"], "first second")

    def test_generate_node_uses_configured_llm_model(self):
        from agents.nodes import generate

        fake_settings = SimpleNamespace(
            openai_api_key="api-key",
            openai_base_url="https://api.example.test/v1",
            llm_model=EXPECTED_MODEL,
        )

        with (
            patch.object(generate, "settings", fake_settings),
            patch.object(generate.ChatPromptTemplate, "from_messages", return_value=_FakePrompt()),
            patch.object(generate, "ChatOpenAI") as chat_openai,
        ):
            asyncio.run(
                generate.generate_node(
                    {
                        "query": "test query",
                        "documents": [{"content": "test document"}],
                        "analysis": "test analysis",
                    }
                )
            )

        chat_openai.assert_called_once_with(
            model=EXPECTED_MODEL,
            temperature=0.5,
            api_key="api-key",
            base_url="https://api.example.test/v1",
            extra_body={"reasoning_split": True},
        )

    def test_generate_node_strips_embedded_think_tags(self):
        from agents.nodes import generate

        _FakeChain.response = SimpleNamespace(
            content="<think>report thinking</think>\n\n# Final Report",
            additional_kwargs={},
        )
        fake_settings = SimpleNamespace(
            openai_api_key="api-key",
            openai_base_url="https://api.example.test/v1",
            llm_model=EXPECTED_MODEL,
        )

        with (
            patch.object(generate, "settings", fake_settings),
            patch.object(generate.ChatPromptTemplate, "from_messages", return_value=_FakePrompt()),
            patch.object(generate, "ChatOpenAI"),
        ):
            result = asyncio.run(
                generate.generate_node(
                    {
                        "query": "test query",
                        "documents": [{"content": "test document"}],
                        "analysis": "test analysis",
                    }
                )
            )

        self.assertEqual(result["report"], "# Final Report")
        self.assertEqual(result["report_thinking"], "report thinking")

    def test_generate_node_uses_resolved_query_when_available(self):
        from agents.nodes import generate

        with (
            patch.object(generate.ChatPromptTemplate, "from_messages", return_value=_FakePrompt()),
            patch.object(generate, "ChatOpenAI"),
        ):
            asyncio.run(
                generate.generate_node(
                    {
                        "query": "Previous conversation context: user: 谁是hasmokan",
                        "display_query": "所以他在 codeforce 上多少分",
                        "resolved_query": "hasmokan Codeforces rating",
                        "documents": [{"content": "test document"}],
                        "analysis": "test analysis",
                    }
                )
            )

        self.assertEqual(_FakeChain.seen_payloads[-1]["query"], "hasmokan Codeforces rating")

    def test_stream_generate_node_yields_reasoning_content_deltas(self):
        from agents.nodes import generate

        _FakeChain.stream_chunks = [
            SimpleNamespace(content="", additional_kwargs={"reasoning_content": "planning report"}),
            SimpleNamespace(content="# Final Report", additional_kwargs={}),
        ]
        fake_settings = SimpleNamespace(
            openai_api_key="api-key",
            openai_base_url="https://api.example.test/v1",
            llm_model=EXPECTED_MODEL,
        )

        with (
            patch.object(generate, "settings", fake_settings),
            patch.object(generate.ChatPromptTemplate, "from_messages", return_value=_FakePrompt()),
            patch.object(generate, "ChatOpenAI"),
        ):
            events = asyncio.run(_collect_async_events(generate.stream_generate_node({
                "query": "test query",
                "documents": [{"content": "test document"}],
                "analysis": "test analysis",
            })))

        self.assertEqual(events[0]["type"], "thinking")
        self.assertEqual(events[0]["id"], "report-thinking")
        self.assertEqual(events[0]["text"], "planning report")
        self.assertEqual(events[1]["type"], "final")
        self.assertEqual(events[1]["state"]["report"], "# Final Report")
        self.assertEqual(events[1]["state"]["report_thinking"], "planning report")

    def test_stream_generate_node_yields_visible_draft_content_deltas(self):
        from agents.nodes import generate

        _FakeChain.stream_chunks = [
            SimpleNamespace(content="# Report\n\n", additional_kwargs={}),
            SimpleNamespace(content="Finding one.", additional_kwargs={}),
        ]
        fake_settings = SimpleNamespace(
            openai_api_key="api-key",
            openai_base_url="https://api.example.test/v1",
            llm_model=EXPECTED_MODEL,
        )

        with (
            patch.object(generate, "settings", fake_settings),
            patch.object(generate.ChatPromptTemplate, "from_messages", return_value=_FakePrompt()),
            patch.object(generate, "ChatOpenAI"),
        ):
            events = asyncio.run(_collect_async_events(generate.stream_generate_node({
                "query": "test query",
                "documents": [{"content": "test document"}],
                "analysis": "test analysis",
            })))

        self.assertEqual(events[0]["type"], "draft")
        self.assertEqual(events[0]["id"], "report-draft")
        self.assertEqual(events[0]["text"], "# Report")
        self.assertEqual(events[1]["type"], "draft")
        self.assertEqual(events[1]["text"], "# Report\n\nFinding one.")
        self.assertEqual(events[2]["type"], "final")
        self.assertEqual(events[2]["state"]["report"], "# Report\n\nFinding one.")


class ResearchRouterThinkingTests(TestCase):
    def test_execute_research_returns_thinking_fields(self):
        from routers import research
        from services.auth import AuthenticatedUser

        with (
            patch.object(research.research_agent, "ainvoke", new=AsyncMock(return_value={
                "query": "test query",
                "documents": [],
                "analysis": "analysis answer",
                "analysis_thinking": "analysis thinking",
                "report": "report answer",
                "report_thinking": "report thinking",
                "report_completed": True,
            })),
            patch.object(research, "research_memory_store", EmptyMemoryStore()),
        ):
            result = asyncio.run(
                research.execute_research(
                    ResearchRequest(query="test query"),
                    AuthenticatedUser(user_id="user-1"),
                )
            )

        self.assertEqual(result["analysis_thinking"], "analysis thinking")
        self.assertEqual(result["report_thinking"], "report thinking")


async def _collect_async_events(stream):
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
