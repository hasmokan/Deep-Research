"""Conversation query resolution for follow-up research turns."""

import asyncio
import json
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch


class _FakePrompt:
    def __or__(self, llm):
        return _FakeChain()


class _FakeChain:
    response = SimpleNamespace(content="{}", additional_kwargs={})
    seen_payloads = []

    async def ainvoke(self, payload):
        self.seen_payloads.append(payload)
        return self.response


class QueryResolutionTests(TestCase):
    def setUp(self):
        _FakeChain.seen_payloads = []

    def test_query_without_history_does_not_call_llm(self):
        from agents.nodes import query_resolution

        with patch.object(query_resolution, "ChatOpenAI", side_effect=AssertionError("should not call llm")):
            result = asyncio.run(query_resolution.resolve_research_query_node({
                "query": "谁是hasmokan",
                "display_query": "谁是hasmokan",
            }))

        self.assertEqual(result["resolved_query"], "谁是hasmokan")
        self.assertEqual(result["search_query"], "谁是hasmokan")
        self.assertFalse(result["context_resolution"]["used_context"])

    def test_contextual_follow_up_is_rewritten_for_router_and_search(self):
        from agents.nodes import query_resolution

        _FakeChain.response = SimpleNamespace(
            content=json.dumps({
                "resolved_query": "What is hasmokan's Codeforces rating?",
                "search_query": "hasmokan Codeforces rating",
                "used_context": True,
                "reason": "The prior turn identifies '他' as hasmokan.",
            }),
            additional_kwargs={},
        )

        state = {
            "query": (
                "Use the previous conversation context only when it is necessary.\n\n"
                "Previous conversation context:\n"
                "user: 谁是hasmokan\n"
                "assistant: hasmokan 是一个 GitHub 用户。\n\n"
                "Current user request:\n"
                "所以他在 codeforce 上多少分"
            ),
            "display_query": "所以他在 codeforce 上多少分",
        }

        with (
            patch.object(query_resolution.ChatPromptTemplate, "from_messages", return_value=_FakePrompt()),
            patch.object(query_resolution, "ChatOpenAI"),
        ):
            result = asyncio.run(query_resolution.resolve_research_query_node(state))

        self.assertEqual(result["resolved_query"], "What is hasmokan's Codeforces rating?")
        self.assertEqual(result["search_query"], "hasmokan Codeforces rating")
        self.assertTrue(result["context_resolution"]["used_context"])
        self.assertEqual(_FakeChain.seen_payloads[-1]["display_query"], "所以他在 codeforce 上多少分")
        self.assertIn("Previous conversation context:", _FakeChain.seen_payloads[-1]["contextual_query"])
