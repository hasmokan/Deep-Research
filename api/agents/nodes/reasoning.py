"""Helpers for separating model reasoning from final answer content."""

from __future__ import annotations

import re
from typing import Any


THINK_TAG_PATTERN = re.compile(r"<think>(.*?)</think>", re.DOTALL | re.IGNORECASE)


def extract_response_parts(response: Any) -> tuple[str, str | None]:
    """Return final content and optional thinking text from an LLM response."""
    content = str(getattr(response, "content", "") or "")
    thinking = _extract_reasoning_details(getattr(response, "additional_kwargs", {}) or {})

    embedded_thinking = _extract_embedded_thinking(content)
    cleaned_content = THINK_TAG_PATTERN.sub("", content).strip()

    if thinking:
        return cleaned_content, thinking
    return cleaned_content, embedded_thinking


def _extract_embedded_thinking(content: str) -> str | None:
    matches = [match.strip() for match in THINK_TAG_PATTERN.findall(content)]
    return "\n\n".join(match for match in matches if match) or None


def _extract_reasoning_details(additional_kwargs: dict[str, Any]) -> str | None:
    details = (
        additional_kwargs.get("reasoning_details")
        or additional_kwargs.get("reasoning")
        or additional_kwargs.get("reasoning_content")
    )
    return _coerce_reasoning_text(details)


def _coerce_reasoning_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value.strip() or None
    if isinstance(value, list):
        parts = [_coerce_reasoning_text(item) for item in value]
        return "\n\n".join(part for part in parts if part) or None
    if isinstance(value, dict):
        for key in ("text", "content", "thinking", "reasoning", "summary"):
            text = _coerce_reasoning_text(value.get(key))
            if text:
                return text
    return None
