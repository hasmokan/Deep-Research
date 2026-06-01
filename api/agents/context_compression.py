"""Helpers for keeping active agent context compact and continuous."""

from __future__ import annotations

import copy
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

PERSIST_THRESHOLD = 6000
PERSIST_PREVIEW_CHARS = 2000
DEFAULT_TOOL_OUTPUT_DIR = Path(".task_outputs/tool-results")
TOOL_RESULT_PLACEHOLDER = "[Earlier tool result omitted for brevity]"

_FILE_PATH_PATTERN = re.compile(r"(?:[A-Za-z0-9_.-]+/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9]+")


@dataclass
class CompactState:
    """Minimal state that describes whether and how context was compacted."""

    has_compacted: bool = False
    last_summary: str = ""
    recent_files: list[str] = field(default_factory=list)


def persist_large_output(
    tool_use_id: str,
    output: str,
    *,
    output_dir: Path | str = DEFAULT_TOOL_OUTPUT_DIR,
    threshold: int = PERSIST_THRESHOLD,
    preview_chars: int = PERSIST_PREVIEW_CHARS,
) -> str:
    """Persist oversized output and return a marker with a short preview."""
    text = str(output or "")
    if len(text) <= threshold:
        return text

    stored_path = Path(output_dir) / f"{_safe_file_stem(tool_use_id)}.txt"
    preview = text[:preview_chars]

    try:
        stored_path.parent.mkdir(parents=True, exist_ok=True)
        stored_path.write_text(text, encoding="utf-8")
        path_label = str(stored_path)
    except OSError:
        path_label = "(not persisted; write failed)"

    return (
        "<persisted-output>\n"
        f"Full output saved to: {path_label}\n"
        f"Preview:\n{preview}\n"
        "</persisted-output>"
    )


def micro_compact_tool_messages(
    messages: list[Any],
    *,
    keep_recent: int = 3,
    placeholder: str = TOOL_RESULT_PLACEHOLDER,
) -> list[Any]:
    """Replace older tool observations with a compact placeholder."""
    compacted = list(messages)
    tool_indices = [
        index
        for index, message in enumerate(compacted)
        if _is_tool_message(message)
    ]
    compact_indices = tool_indices if keep_recent <= 0 else tool_indices[:-keep_recent]

    for index in compact_indices:
        compacted[index] = _copy_message_with_content(compacted[index], placeholder)

    return compacted


def compact_conversation_history(
    history: list[dict[str, str]],
    *,
    max_messages: int = 8,
    max_context_chars: int = 6000,
) -> tuple[list[dict[str, str]], CompactState]:
    """Return recent messages plus a continuity summary when history is too large."""
    state = CompactState()
    if not history:
        return [], state

    recent_messages = _trim_recent_messages(history[-max_messages:], max_context_chars=max_context_chars)
    rendered_full_context = "\n".join(
        f"{message['role']}: {message['content']}"
        for message in history
    )
    should_compact = len(history) > max_messages or len(rendered_full_context) > max_context_chars

    if not should_compact:
        return recent_messages, state

    state.has_compacted = True
    state.recent_files = _extract_recent_files(history)
    state.last_summary = _build_continuity_summary(
        history,
        omitted_count=max(len(history) - len(recent_messages), 0),
        recent_files=state.recent_files,
    )
    return recent_messages, state


def _build_continuity_summary(
    history: list[dict[str, str]],
    *,
    omitted_count: int,
    recent_files: list[str],
) -> str:
    first_user = _first_content(history, "user")
    latest_user = _last_content(history, "user")
    latest_assistant = _last_content(history, "assistant")
    key_decision = _find_key_decision(history)

    lines = [
        "Context continuity summary:",
        f"- Omitted earlier messages: {omitted_count}",
    ]
    if first_user:
        lines.append(f"- Current thread goal: {_preview(first_user)}")
    if latest_user and latest_user != first_user:
        lines.append(f"- Recent user focus: {_preview(latest_user)}")
    if latest_assistant:
        lines.append(f"- Latest assistant state: {_preview(latest_assistant)}")
    if key_decision:
        lines.append(f"- Key decision or constraint: {_preview(key_decision)}")
    if recent_files:
        lines.append(f"- Recently mentioned files: {', '.join(recent_files)}")

    return "\n".join(lines)


def _trim_recent_messages(
    messages: list[dict[str, str]],
    *,
    max_context_chars: int,
) -> list[dict[str, str]]:
    if not messages:
        return []

    per_message_limit = max(120, min(1200, max_context_chars // max(len(messages), 1)))
    trimmed = []
    for message in messages:
        content = message["content"]
        if len(content) > per_message_limit:
            content = f"{content[:per_message_limit].rstrip()}... [trimmed]"
        trimmed.append({"role": message["role"], "content": content})
    return trimmed


def _extract_recent_files(history: list[dict[str, str]]) -> list[str]:
    files: list[str] = []
    for message in history:
        for file_path in _FILE_PATH_PATTERN.findall(message["content"]):
            if file_path not in files:
                files.append(file_path)
    return files[-8:]


def _find_key_decision(history: list[dict[str, str]]) -> str:
    decision_markers = ("decision:", "decided", "must ", "constraint", "约束", "决定")
    for message in reversed(history):
        content = message["content"]
        lowered = content.lower()
        if any(marker in lowered for marker in decision_markers):
            return content
    return ""


def _first_content(history: list[dict[str, str]], role: str) -> str:
    for message in history:
        if message["role"] == role:
            return message["content"]
    return ""


def _last_content(history: list[dict[str, str]], role: str) -> str:
    for message in reversed(history):
        if message["role"] == role:
            return message["content"]
    return ""


def _preview(content: str, limit: int = 180) -> str:
    text = " ".join(content.split())
    if len(text) <= limit:
        return text
    return f"{text[:limit].rstrip()}..."


def _is_tool_message(message: Any) -> bool:
    return str(getattr(message, "type", "") or "").lower() == "tool"


def _copy_message_with_content(message: Any, content: str) -> Any:
    model_copy = getattr(message, "model_copy", None)
    if callable(model_copy):
        return model_copy(update={"content": content})

    cloned = copy.copy(message)
    try:
        setattr(cloned, "content", content)
    except Exception:
        return message
    return cloned


def _safe_file_stem(value: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "-", str(value or "tool-output")).strip(".-")
    return safe or "tool-output"
