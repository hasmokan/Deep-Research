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
