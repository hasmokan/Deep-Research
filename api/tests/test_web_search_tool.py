"""Agent-facing web search tool behavior."""

import asyncio
from unittest import TestCase


class WebSearchToolTests(TestCase):
    def test_identity_queries_expand_dedupe_and_rank_exact_matches(self):
        from agents.tools.web_search_tool import WebSearchTool

        class FakeSearchService:
            def __init__(self):
                self.search_queries = []
                self.news_queries = []

            async def search(self, query, max_results=10, region="wt-wt"):
                self.search_queries.append(query)
                if query == "hasmokan":
                    return [
                        {
                            "title": "Generic wiki mirror",
                            "url": "https://example.com/wiki",
                            "content": "A generic page without the handle.",
                            "source": "duckduckgo",
                            "provider": "duckduckgo",
                            "type": "web_search",
                        },
                        {
                            "title": "hasmokan profile",
                            "url": "https://github.com/hasmokan",
                            "content": "Code and projects by hasmokan.",
                            "source": "duckduckgo",
                            "provider": "duckduckgo",
                            "type": "web_search",
                        },
                    ]
                if query == "\"hasmokan\"":
                    return [
                        {
                            "title": "Duplicate hasmokan profile",
                            "url": "https://github.com/hasmokan/",
                            "content": "Duplicate profile result.",
                            "source": "duckduckgo",
                            "provider": "duckduckgo",
                            "type": "web_search",
                        },
                        {
                            "title": "hasmokan on X",
                            "url": "https://x.com/hasmokan",
                            "content": "Social profile for hasmokan.",
                            "source": "duckduckgo",
                            "provider": "duckduckgo",
                            "type": "web_search",
                        },
                    ]
                return []

            async def search_news(self, query, max_results=5, region="wt-wt"):
                self.news_queries.append(query)
                return []

        service = FakeSearchService()
        tool = WebSearchTool(search_service=service)

        results = asyncio.run(tool.search("hasmokan是谁", max_results=3))

        self.assertIn("hasmokan", service.search_queries)
        self.assertIn('"hasmokan"', service.search_queries)
        self.assertEqual([result["url"] for result in results], [
            "https://github.com/hasmokan",
            "https://x.com/hasmokan",
            "https://example.com/wiki",
        ])
        self.assertEqual(results[0]["metadata"]["domain"], "github.com")
        self.assertGreater(results[0]["metadata"]["rank_score"], results[-1]["metadata"]["rank_score"])
        self.assertEqual(service.news_queries, [])

    def test_news_queries_include_ddgs_news_results(self):
        from agents.tools.web_search_tool import WebSearchTool

        class FakeSearchService:
            async def search(self, query, max_results=10, region="wt-wt"):
                return []

            async def search_news(self, query, max_results=5, region="wt-wt"):
                return [
                    {
                        "title": "AI regulation update",
                        "url": "https://news.example.com/ai",
                        "content": "New policy details.",
                        "source": "Example News",
                        "provider": "duckduckgo",
                        "type": "news",
                    }
                ]

        tool = WebSearchTool(search_service=FakeSearchService())

        results = asyncio.run(tool.search("latest AI regulation news", max_results=5))

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["type"], "news")
        self.assertEqual(results[0]["metadata"]["domain"], "news.example.com")
