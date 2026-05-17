"""Web search service using DuckDuckGo (free, no API key required)"""

import asyncio
from typing import List, Dict, Any, Optional
from ddgs import DDGS


class WebSearchService:
    """Service for performing web searches using DuckDuckGo"""

    def __init__(self):
        self.ddgs = DDGS()

    async def search(
        self,
        query: str,
        max_results: int = 10,
        region: str = "wt-wt",  # Worldwide
        safesearch: str = "moderate",
        timelimit: str | None = None,
        backend: str = "auto",
        page: int = 1,
    ) -> List[Dict[str, Any]]:
        """
        Perform a web search using DuckDuckGo

        Args:
            query: Search query string
            max_results: Maximum number of results to return
            region: Region for search results (wt-wt = worldwide)
            safesearch: Safe search setting (on, moderate, off)
            timelimit: Optional time filter (d, w, m, y)
            backend: DDGS backend selection
            page: Result page number

        Returns:
            List of search results with title, url, and body
        """
        try:
            results = await asyncio.to_thread(
                lambda: list(self.ddgs.text(
                    query,
                    region=region,
                    safesearch=safesearch,
                    timelimit=timelimit,
                    max_results=max_results,
                    backend=backend,
                    page=page,
                ))
            )

            # Format results
            formatted_results = []
            for result in results:
                formatted_results.append({
                    "title": result.get("title", ""),
                    "url": result.get("href", ""),
                    "content": result.get("body", ""),
                    "source": "duckduckgo",
                    "provider": "duckduckgo",
                    "type": "web_search",
                })

            return formatted_results

        except Exception as e:
            print(f"Web search error: {e}")
            return []

    async def search_news(
        self,
        query: str,
        max_results: int = 10,
        region: str = "wt-wt",
        safesearch: str = "moderate",
        timelimit: str | None = None,
        backend: str = "auto",
        page: int = 1,
    ) -> List[Dict[str, Any]]:
        """
        Search for news articles using DuckDuckGo

        Args:
            query: Search query string
            max_results: Maximum number of results
            region: Region for news results
            safesearch: Safe search setting (on, moderate, off)
            timelimit: Optional time filter (d, w, m)
            backend: DDGS backend selection
            page: Result page number

        Returns:
            List of news results
        """
        try:
            results = await asyncio.to_thread(
                lambda: list(self.ddgs.news(
                    query,
                    region=region,
                    safesearch=safesearch,
                    timelimit=timelimit,
                    max_results=max_results,
                    backend=backend,
                    page=page,
                ))
            )

            formatted_results = []
            for result in results:
                formatted_results.append({
                    "title": result.get("title", ""),
                    "url": result.get("url", ""),
                    "content": result.get("body", ""),
                    "date": result.get("date", ""),
                    "source": result.get("source", ""),
                    "provider": "duckduckgo",
                    "type": "news"
                })

            return formatted_results

        except Exception as e:
            print(f"News search error: {e}")
            return []


# Singleton instance
_web_search_service: Optional[WebSearchService] = None


def get_web_search_service() -> WebSearchService:
    """Get or create WebSearchService singleton instance"""
    global _web_search_service
    if _web_search_service is None:
        _web_search_service = WebSearchService()
    return _web_search_service
