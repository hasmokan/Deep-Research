"""Conversation context helpers for multi-turn research requests."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

VALID_ROLES = {"user", "assistant"}


def build_contextual_research_query(
    query: str,
    messages: Sequence[Any] | None = None,
    *,
    max_messages: int = 8,
    max_context_chars: int = 6000,
) -> str:
    """Combine a follow-up request with recent conversation history."""
    normalized_query = query.strip()
    history = _normalize_messages(messages or [])

    if history and history[-1]["role"] == "user" and history[-1]["content"] == normalized_query:
        history = history[:-1]

    if not history:
        return normalized_query

    recent_history = history[-max_messages:]
    context_lines = [
        f"{message['role']}: {message['content']}"
        for message in recent_history
    ]
    context = "\n".join(context_lines)

    if len(context) > max_context_chars:
        context = f"...{context[-max_context_chars:].strip()}"

    return (
        "Use the previous conversation context to resolve references, follow-up wording, "
        "and implied scope. Then answer the current user request as a standalone deep research task.\n\n"
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
