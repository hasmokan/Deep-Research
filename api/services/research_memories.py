"""Per-user long-term research memory storage."""

from __future__ import annotations

import json
import os
import re
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from core.config import get_settings
from supabase import Client, create_client


_SAFE_USER_ID = re.compile(r"^[A-Za-z0-9_-]+$")


class JsonResearchMemoryStore:
    """One JSON memory document per authenticated user."""

    def __init__(self, base_dir: str | Path | None = None):
        default_dir = Path(__file__).resolve().parents[1] / "data" / "memories"
        self.base_dir = Path(base_dir or os.getenv("RESEARCH_MEMORIES_DIR") or default_dir)
        self._lock = threading.Lock()

    def get_memory(self, user_id: str) -> dict[str, Any]:
        path = self._memory_file(user_id)

        with self._lock:
            memory = self._read_memory_unlocked(path)

        return _normalize_memory(memory, user_id)

    def save_memory(self, user_id: str, memory: dict[str, Any]) -> dict[str, Any]:
        path = self._memory_file(user_id)
        normalized = _normalize_memory({**memory, "user_id": user_id}, user_id)

        with self._lock:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(normalized, ensure_ascii=False, default=str), encoding="utf-8")

        return normalized

    def remember_result(self, user_id: str, result: dict[str, Any], *, now: str | None = None) -> dict[str, Any]:
        memory = self.get_memory(user_id)
        next_memory = remember_research_result(memory, result, now=now)
        return self.save_memory(user_id, next_memory)

    def _memory_file(self, user_id: str) -> Path:
        _validate_user_id(user_id)
        return self.base_dir / f"{user_id}.json"

    @staticmethod
    def _read_memory_unlocked(path: Path) -> dict[str, Any] | None:
        if not path.exists():
            return None

        try:
            memory = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None

        return memory if isinstance(memory, dict) else None


class SupabaseResearchMemoryStore:
    """Supabase-backed per-user memory storage."""

    def __init__(self, client: Client | None = None):
        self.supabase = client or _create_supabase_client()

    def get_memory(self, user_id: str) -> dict[str, Any]:
        _validate_user_id(user_id)
        response = (
            self.supabase
            .table("research_memories")
            .select("*")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        row = _first_row(response.data)
        return _normalize_memory(row, user_id)

    def save_memory(self, user_id: str, memory: dict[str, Any]) -> dict[str, Any]:
        _validate_user_id(user_id)
        normalized = _normalize_memory({**memory, "user_id": user_id}, user_id)
        response = (
            self.supabase
            .table("research_memories")
            .upsert(_jsonable(normalized), on_conflict="user_id")
            .execute()
        )
        return _normalize_memory(_first_row(response.data) or normalized, user_id)

    def remember_result(self, user_id: str, result: dict[str, Any], *, now: str | None = None) -> dict[str, Any]:
        memory = self.get_memory(user_id)
        next_memory = remember_research_result(memory, result, now=now)
        return self.save_memory(user_id, next_memory)


def create_research_memory_store():
    settings = get_settings()
    if settings.research_storage_backend.lower() == "supabase":
        return SupabaseResearchMemoryStore()
    return JsonResearchMemoryStore()


def remember_research_result(memory: dict[str, Any], result: dict[str, Any], *, now: str | None = None) -> dict[str, Any]:
    """No-op until durable user memory has an explicit schema and writer."""
    del result, now
    return memory


def build_memory_context(memory: dict[str, Any]) -> str:
    """Return prompt context for durable memory.

    Recent research queries are not durable memory, so they are intentionally
    excluded from prompts.
    """
    del memory
    return ""


def _create_supabase_client() -> Client:
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_service_key or settings.supabase_key)


def _normalize_memory(memory: dict[str, Any] | None, user_id: str) -> dict[str, Any]:
    if not isinstance(memory, dict):
        return _empty_memory(user_id)

    updated_at = memory.get("updated_at")

    return {
        "user_id": user_id,
        "summary": "",
        "recent_topics": [],
        "updated_at": updated_at if isinstance(updated_at, str) else _now(),
    }


def _empty_memory(user_id: str) -> dict[str, Any]:
    return {
        "user_id": user_id,
        "summary": "",
        "recent_topics": [],
        "updated_at": _now(),
    }


def _validate_user_id(user_id: str) -> None:
    if not _SAFE_USER_ID.match(user_id):
        raise ValueError(f"Invalid user_id: {user_id!r}")


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _jsonable(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False, default=str))


def _first_row(rows: Any) -> dict[str, Any] | None:
    if isinstance(rows, list) and rows:
        row = rows[0]
        return row if isinstance(row, dict) else None
    return None


research_memory_store = create_research_memory_store()
