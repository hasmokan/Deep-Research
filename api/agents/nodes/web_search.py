"""Web search node - Search the internet for relevant information"""

from typing import Any
from urllib.parse import urlparse

from services.web_search import get_web_search_service


async def web_search_node(state: dict[str, Any]) -> dict[str, Any]:
    """
    Web search node - search the internet using DuckDuckGo

    Args:
        state: Current graph state containing 'query'

    Returns:
        Updated state with 'web_results' field
    """
    web_search = get_web_search_service()
    query = state["query"]

    # Perform web search
    web_results = await web_search.search(
        query=query,
        max_results=10
    )

    # Also search for news if relevant
    news_results = await web_search.search_news(
        query=query,
        max_results=5
    )

    # Combine results
    all_results = web_results + news_results

    # Convert to document format for consistency with vector search
    documents = []
    for i, result in enumerate(all_results):
        url = result.get("url", "")
        title = result.get("title", "")
        source = _source_label(url, result.get("source", ""))
        documents.append({
            "id": f"web_{i}",
            "content": f"**{title}**\n\n{result.get('content', '')}",
            "metadata": {
                "title": title,
                "url": url,
                "source": source,
                "provider": result.get("provider", "duckduckgo"),
                "type": result.get("type", "web_search"),
            },
            "similarity": 1.0  # Web results are considered relevant
        })

    return {
        "documents": documents,
        "web_search_completed": True
    }


def _source_label(url: str, fallback: str) -> str:
    hostname = urlparse(url).hostname or ""
    normalized_hostname = hostname.removeprefix("www.")

    if normalized_hostname:
        return normalized_hostname

    return fallback or "web"
