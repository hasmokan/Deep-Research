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

    async def ainvoke(self, payload):
        return self.response


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


class ResearchRouterThinkingTests(TestCase):
    def test_execute_research_returns_thinking_fields(self):
        from routers import research

        with patch.object(research.research_agent, "ainvoke", new=AsyncMock(return_value={
            "query": "test query",
            "documents": [],
            "analysis": "analysis answer",
            "analysis_thinking": "analysis thinking",
            "report": "report answer",
            "report_thinking": "report thinking",
            "report_completed": True,
        })):
            result = asyncio.run(
                research.execute_research(ResearchRequest(query="test query"))
            )

        self.assertEqual(result["analysis_thinking"], "analysis thinking")
        self.assertEqual(result["report_thinking"], "report thinking")
