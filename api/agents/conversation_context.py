"""Conversation context helpers for multi-turn research requests."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

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
    """Combine a follow-up request with recent conversation history."""
    normalized_query = query.strip()
    memory = " ".join((memory_context or "").split())
    history = _normalize_messages(messages or [])

    if history and history[-1]["role"] == "user" and history[-1]["content"] == normalized_query:
        history = history[:-1]

    if not history and not memory:
        return normalized_query

    context_sections = []

    if memory:
        if len(memory) > max_memory_chars:
            memory = f"...{memory[-max_memory_chars:].strip()}"
        context_sections.append(memory if memory.startswith("Long-term user memo:") else f"Long-term user memo:\n{memory}")

    if history:
        recent_history = history[-max_messages:]
        context_lines = [
            f"{message['role']}: {message['content']}"
            for message in recent_history
        ]
        context = "\n".join(context_lines)

        if len(context) > max_context_chars:
            context = f"...{context[-max_context_chars:].strip()}"

        context_sections.append(
            "Previous conversation context:\n"
            f"{context}"
        )

    combined_context = "\n\n".join(context_sections)

    return (
        "Use the available long-term memo and previous conversation context to resolve references, follow-up wording, "
        "and implied scope. Then answer the current user request as a standalone deep research task.\n\n"
        f"{combined_context}\n\n"
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
