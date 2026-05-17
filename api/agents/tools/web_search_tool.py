"""Agent-facing web search tool built on top of the DDGS service."""

import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from services.web_search import WebSearchService, get_web_search_service


IDENTITY_MARKERS = (
    "是谁",
    "谁是",
    "什么人",
    "身份",
    "账号",
    "profile",
    "who is",
    "github",
    "twitter",
    "x.com",
    "linkedin",
)

NEWS_MARKERS = (
    "latest",
    "news",
    "breaking",
    "recent",
    "today",
    "新闻",
    "最新",
    "最近",
    "动态",
)

SOURCE_MARKERS = (
    "source",
    "sources",
    "citation",
    "citations",
    "来源",
    "引用",
    "出处",
    "数据来源",
)

QUESTION_MARKERS = (
    "是谁",
    "谁是",
    "是什么",
    "什么是",
    "帮我",
    "搜索",
    "查一下",
    "查询",
    "请问",
    "关于",
    "的",
    "？",
    "?",
)

PLATFORM_BOOSTS = {
    "github.com": 7,
    "x.com": 6,
    "twitter.com": 6,
    "linkedin.com": 5,
    "zhihu.com": 5,
    "bilibili.com": 5,
    "weibo.com": 5,
    "medium.com": 2,
}


@dataclass(frozen=True)
class SearchQuery:
    query: str
    max_results: int
    region: str = "wt-wt"


class WebSearchTool:
    """Search tool that expands, dedupes, and reranks DDGS results."""

    def __init__(self, search_service: WebSearchService | None = None):
        self.search_service = search_service or get_web_search_service()

    async def search(self, query: str, max_results: int = 15) -> list[dict[str, Any]]:
        normalized_query = query.strip()
        if not normalized_query:
            return []

        key_term = _extract_key_term(normalized_query)
        text_queries = _build_text_queries(normalized_query, key_term, max_results)
        raw_results: list[dict[str, Any]] = []

        for search_query in text_queries:
            raw_results.extend(
                await self.search_service.search(
                    query=search_query.query,
                    max_results=search_query.max_results,
                    region=search_query.region,
                )
            )

        if _has_any_marker(normalized_query, NEWS_MARKERS):
            raw_results.extend(
                await self.search_service.search_news(
                    query=normalized_query,
                    max_results=min(5, max_results),
                    region="wt-wt",
                )
            )

        return _rank_results(
            _dedupe_results(raw_results),
            query=normalized_query,
            key_term=key_term,
            max_results=max_results,
        )


def _build_text_queries(query: str, key_term: str, max_results: int) -> list[SearchQuery]:
    per_query_limit = max(3, min(8, max_results))
    candidates = [query]

    if key_term and key_term != query:
        candidates.append(key_term)

    if key_term and _has_any_marker(query, IDENTITY_MARKERS):
        candidates.extend([
            f'"{key_term}"',
            f"{key_term} GitHub",
            f"{key_term} X Twitter",
            f"{key_term} LinkedIn",
        ])
    elif key_term and _has_any_marker(query, SOURCE_MARKERS):
        candidates.extend([
            f'"{key_term}" source',
            f"{key_term} citation",
            f"{key_term} 数据来源",
        ])

    return [
        SearchQuery(query=candidate, max_results=per_query_limit)
        for candidate in _unique_strings(candidates)
    ]


def _extract_key_term(query: str) -> str:
    latin_tokens = re.findall(r"[@A-Za-z0-9_.-]{2,}", query)
    if latin_tokens:
        return latin_tokens[0].removeprefix("@")

    cleaned = query.strip()
    for marker in QUESTION_MARKERS:
        cleaned = cleaned.replace(marker, " ")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned or query


def _dedupe_results(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []

    for result in results:
        url = result.get("url") or result.get("href") or ""
        title = result.get("title") or ""
        if not url or not title:
            continue

        normalized_url = _normalize_url(url)
        if normalized_url in seen:
            continue

        seen.add(normalized_url)
        normalized_result = dict(result)
        normalized_result["url"] = url.rstrip("/")
        deduped.append(normalized_result)

    return deduped


def _rank_results(
    results: list[dict[str, Any]],
    query: str,
    key_term: str,
    max_results: int,
) -> list[dict[str, Any]]:
    ranked_results = []
    for index, result in enumerate(results):
        domain = _domain_for(result.get("url", ""))
        score = _rank_score(result, query=query, key_term=key_term, domain=domain)
        enriched = dict(result)
        metadata = dict(enriched.get("metadata") or {})
        metadata.update({
            "domain": domain,
            "rank_score": score,
        })
        enriched["metadata"] = metadata
        ranked_results.append((score, index, enriched))

    ranked_results.sort(key=lambda item: (-item[0], item[1]))
    return [result for _, _, result in ranked_results[:max_results]]


def _rank_score(result: dict[str, Any], query: str, key_term: str, domain: str) -> int:
    title = str(result.get("title") or "").lower()
    content = str(result.get("content") or result.get("body") or "").lower()
    url = str(result.get("url") or result.get("href") or "").lower()
    key = key_term.lower()
    score = 0

    if key:
        if key in title:
            score += 9
        if key in url:
            score += 7
        if key in content:
            score += 5

    if _has_any_marker(query, IDENTITY_MARKERS):
        score += _platform_boost(domain)

    if result.get("type") == "news":
        score += 3 if _has_any_marker(query, NEWS_MARKERS) else -2

    return score


def _platform_boost(domain: str) -> int:
    for platform, boost in PLATFORM_BOOSTS.items():
        if domain == platform or domain.endswith(f".{platform}"):
            return boost
    return 0


def _normalize_url(url: str) -> str:
    parsed = urlparse(url)
    hostname = (parsed.hostname or "").lower().removeprefix("www.")
    path = parsed.path.rstrip("/")
    query_params = [
        (key, value)
        for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        if not key.lower().startswith("utm_")
    ]
    return urlunparse((
        parsed.scheme.lower() or "https",
        hostname,
        path,
        "",
        urlencode(query_params),
        "",
    ))


def _domain_for(url: str) -> str:
    return (urlparse(url).hostname or "").lower().removeprefix("www.")


def _has_any_marker(text: str, markers: tuple[str, ...]) -> bool:
    lowered = text.lower()
    return any(marker.lower() in lowered for marker in markers)


def _unique_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    unique: list[str] = []

    for value in values:
        normalized = value.strip()
        dedupe_key = normalized.lower()
        if normalized and dedupe_key not in seen:
            seen.add(dedupe_key)
            unique.append(normalized)

    return unique
