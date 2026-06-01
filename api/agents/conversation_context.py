"""Conversation context helpers for multi-turn research requests."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from agents.context_compression import compact_conversation_history

VALID_ROLES = {"user", "assistant"}


def build_contextual_research_query(
    query: str,
    messages: Sequence[Any] | None = None,
    *,
    memory_context: str | None = None,
    max_messages: int = 8,
    max_memory_chars: int = 2000,
    max_context_chars: int = 6000,
) -> str:
    """Combine a request with recent in-thread conversation history."""
    normalized_query = query.strip()
    history = _normalize_messages(messages or [])

    if history and history[-1]["role"] == "user" and history[-1]["content"] == normalized_query:
        history = history[:-1]

    if not history:
        return normalized_query

    del memory_context, max_memory_chars

    recent_history, compact_state = compact_conversation_history(
        history,
        max_messages=max_messages,
        max_context_chars=max_context_chars,
    )
    recent_context = "\n".join(
        f"{message['role']}: {message['content']}"
        for message in recent_history
    )
    context_parts = []
    if compact_state.last_summary:
        context_parts.append(compact_state.last_summary)
    if recent_context:
        context_parts.append(recent_context)
    context = "\n\n".join(context_parts)

    return (
        "Use the previous conversation context only when it is necessary to resolve references, follow-up wording, "
        "or implied scope. Treat the current user request as authoritative.\n\n"
        "Previous conversation context:\n"
        f"{context}\n\n"
        "Current user request:\n"
        f"{normalized_query}"
    )


def _normalize_messages(messages: Sequence[Any]) -> list[dict[str, str]]:
    normalized: list[dict[str, str]] = []

    for message in messages:
        role = _read_message_value(message, "role")
        content = _read_message_value(message, "content")

        if role not in VALID_ROLES or not content:
            continue

        normalized.append(
            {
                "role": role,
                "content": " ".join(content.split()),
            }
        )

    return normalized


def _read_message_value(message: Any, key: str) -> str:
    if isinstance(message, Mapping):
        value = message.get(key)
    else:
        value = getattr(message, key, None)

    if value is None:
        return ""

    return str(value).strip()
