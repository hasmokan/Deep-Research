"""Helpers for normalizing and accumulating LLM token usage."""

from __future__ import annotations

from typing import Any


TokenUsage = dict[str, int]


def empty_token_usage() -> TokenUsage:
    return {
        "input_tokens": 0,
        "output_tokens": 0,
        "total_tokens": 0,
    }


def add_token_usage(base: TokenUsage | None, delta: TokenUsage | None) -> TokenUsage:
    base_usage = normalize_token_usage(base) or empty_token_usage()
    delta_usage = normalize_token_usage(delta) or empty_token_usage()
    return {
        "input_tokens": base_usage["input_tokens"] + delta_usage["input_tokens"],
        "output_tokens": base_usage["output_tokens"] + delta_usage["output_tokens"],
        "total_tokens": base_usage["total_tokens"] + delta_usage["total_tokens"],
    }


def normalize_token_usage(value: Any) -> TokenUsage | None:
    if not isinstance(value, dict):
        return None

    input_tokens = _to_int(value.get("input_tokens", value.get("prompt_tokens", 0)))
    output_tokens = _to_int(value.get("output_tokens", value.get("completion_tokens", 0)))
    total_tokens = _to_int(value.get("total_tokens", 0))

    if total_tokens <= 0 and (input_tokens > 0 or output_tokens > 0):
        total_tokens = input_tokens + output_tokens

    if input_tokens <= 0 and output_tokens <= 0 and total_tokens <= 0:
        return None

    return {
        "input_tokens": max(input_tokens, 0),
        "output_tokens": max(output_tokens, 0),
        "total_tokens": max(total_tokens, 0),
    }


def extract_token_usage(message: Any) -> TokenUsage | None:
    usage = normalize_token_usage(getattr(message, "usage_metadata", None))
    if usage:
        return usage

    response_metadata = getattr(message, "response_metadata", None)
    if not isinstance(response_metadata, dict):
        return None

    return (
        normalize_token_usage(response_metadata.get("token_usage"))
        or normalize_token_usage(response_metadata.get("usage"))
    )


class TokenUsageAccumulator:
    """Accumulate usage while avoiding duplicate message ids."""

    def __init__(self) -> None:
        self._counted_ids: set[str] = set()
        self._usage = empty_token_usage()
        self._has_usage = False

    @property
    def usage(self) -> TokenUsage | None:
        return dict(self._usage) if self._has_usage else None

    def account_usage(self, usage: Any, usage_id: str | None = None) -> TokenUsage | None:
        normalized = normalize_token_usage(usage)
        if not normalized:
            return None

        if usage_id:
            if usage_id in self._counted_ids:
                return None
            self._counted_ids.add(usage_id)

        self._usage = add_token_usage(self._usage, normalized)
        self._has_usage = True
        return dict(self._usage)

    def account_message(self, message: Any, usage_id: str | None = None) -> TokenUsage | None:
        return self.account_usage(
            extract_token_usage(message),
            usage_id or _message_usage_id(message),
        )


def _message_usage_id(message: Any) -> str | None:
    message_id = getattr(message, "id", None)
    return str(message_id) if message_id else None


def _to_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0
