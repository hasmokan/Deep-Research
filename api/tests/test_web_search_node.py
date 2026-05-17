"""Web search node document metadata."""

import asyncio
from unittest import TestCase
from unittest.mock import patch


class WebSearchNodeTests(TestCase):
    def test_web_search_node_preserves_titles_and_provider_metadata(self):
        from agents.nodes import web_search

        class FakeSearchTool:
            async def search(self, query, max_results=10):
                return [
                    {
                        "title": "Example Result",
                        "url": "https://example.com/report",
                        "content": "Example search result.",
                        "source": "duckduckgo",
                    }
                ]

        with patch.object(web_search, "WebSearchTool", return_value=FakeSearchTool()):
            result = asyncio.run(web_search.web_search_node({"query": "example"}))

        document = result["documents"][0]

        self.assertEqual(document["metadata"]["title"], "Example Result")
        self.assertEqual(document["metadata"]["url"], "https://example.com/report")
        self.assertEqual(document["metadata"]["source"], "example.com")
        self.assertEqual(document["metadata"]["provider"], "duckduckgo")

    def test_web_search_node_uses_display_query_instead_of_context_prompt(self):
        from agents.nodes import web_search

        seen_queries = []

        class FakeSearchTool:
            async def search(self, query, max_results=10):
                seen_queries.append(query)
                return []

        with patch.object(web_search, "WebSearchTool", return_value=FakeSearchTool()):
            asyncio.run(web_search.web_search_node({
                "query": (
                    "Use the previous conversation context to resolve references.\n\n"
                    "Current user request:\n青橘单车的市场占有率"
                ),
                "display_query": "青橘单车的市场占有率",
            }))

        self.assertEqual(seen_queries, ["青橘单车的市场占有率"])
