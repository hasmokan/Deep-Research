"""Resolve follow-up turns into explicit research and search queries."""

from __future__ import annotations

import json
import re
from typing import Any

from langchain.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

from agents.nodes.reasoning import extract_response_parts
from core.config import get_settings
from services.langfuse_observability import ainvoke_langchain, get_langfuse_tracer


settings = get_settings()
JSON_BLOCK_PATTERN = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)
CONTEXT_MARKER = "Previous conversation context:"


async def resolve_research_query_node(state: dict[str, Any]) -> dict[str, Any]:
    """Produce explicit query fields for routing, search, and display."""
    display_query = _clean_text(state.get("display_query") or state.get("query") or "")
    contextual_query = _clean_text(state.get("query") or display_query)

    if not _has_conversation_context(contextual_query, display_query):
        return _resolved_state(
            resolved_query=display_query,
            search_query=display_query,
            used_context=False,
            reason="No previous conversation context was provided.",
        )

    try:
        return await _resolve_with_llm(contextual_query, display_query)
    except Exception as exc:
        return _resolved_state(
            resolved_query=contextual_query,
            search_query=display_query,
            used_context=True,
            reason=f"Query resolver unavailable; preserved contextual query for reasoning. {exc}",
        )


async def _resolve_with_llm(contextual_query: str, display_query: str) -> dict[str, Any]:
    llm = ChatOpenAI(
        model=settings.llm_model,
        temperature=0,
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url,
    )
    prompt = _build_resolution_prompt()
    chain = prompt | llm
    payload = {
        "display_query": display_query,
        "contextual_query": contextual_query,
    }
    response = await ainvoke_langchain(
        chain,
        payload,
        get_langfuse_tracer().langchain_config(
            "query-resolution-llm",
            metadata={
                "feature": "deep-research",
                "stage": "query-resolution",
            },
        ),
    )
    content, _thinking = extract_response_parts(response)
    payload = _parse_json_payload(content)

    resolved_query = _clean_text(payload.get("resolved_query"))
    search_query = _clean_text(payload.get("search_query"))

    if not resolved_query:
        resolved_query = contextual_query
    if not search_query:
        search_query = resolved_query

    return _resolved_state(
        resolved_query=_limit_chars(resolved_query, 1200),
        search_query=_limit_chars(search_query, 300),
        used_context=bool(payload.get("used_context")),
        reason=_clean_text(payload.get("reason")),
    )


def _build_resolution_prompt() -> ChatPromptTemplate:
    return ChatPromptTemplate.from_messages([
        (
            "system",
            """Resolve one research conversation turn.

Return valid JSON only:
{{
  "resolved_query": "standalone request with references resolved",
  "search_query": "short web search query",
  "used_context": true,
  "reason": "brief reason"
}}

Rules:
- Use prior context only to resolve pronouns, follow-up wording, omitted subject, or implied scope.
- Treat the current user request as authoritative.
- Do not invent facts that are not present in the current request or prior context.
- Make resolved_query understandable without the prior conversation.
- Make search_query concise and suitable for a search engine.
- Preserve the user's language unless an English entity/search phrase is clearly better.""",
        ),
        (
            "user",
            """User-facing current turn:
{display_query}

Conversation-aware input:
{contextual_query}""",
        ),
    ])


def _parse_json_payload(content: str) -> dict[str, Any]:
    text = content.strip()
    block_match = JSON_BLOCK_PATTERN.search(text)
    if block_match:
        text = block_match.group(1).strip()

    payload = json.loads(text)
    if not isinstance(payload, dict):
        raise ValueError("Query resolver payload must be a JSON object")
    return payload


def _resolved_state(
    *,
    resolved_query: str,
    search_query: str,
    used_context: bool,
    reason: str,
) -> dict[str, Any]:
    return {
        "resolved_query": resolved_query,
        "search_query": search_query,
        "context_resolution": {
            "used_context": used_context,
            "reason": reason,
        },
    }


def _has_conversation_context(contextual_query: str, display_query: str) -> bool:
    return contextual_query != display_query and CONTEXT_MARKER in contextual_query


def _clean_text(value: Any) -> str:
    return " ".join(str(value or "").split())


def _limit_chars(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    return value[:limit].rstrip()
