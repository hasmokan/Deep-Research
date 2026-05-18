"""Lightweight JSON storage for research conversation threads."""

from __future__ import annotations

import json
import os
import re
import threading
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from core.config import get_settings
from supabase import Client, create_client


_SAFE_THREAD_ID = re.compile(r"^[A-Za-z0-9_-]+$")
_SAFE_USER_ID = re.compile(r"^[A-Za-z0-9_-]+$")


class JsonResearchThreadStore:
    """One JSON document per conversation thread."""

    def __init__(self, base_dir: str | Path | None = None):
        default_dir = Path(__file__).resolve().parents[1] / "data" / "threads"
        self.base_dir = Path(base_dir or os.getenv("RESEARCH_THREADS_DIR") or default_dir)
        self._lock = threading.Lock()

    def create_thread(self, user_id: str, title: str = "New chat", messages: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        return self.upsert_thread(user_id, f"thread-{uuid.uuid4()}", title=title, messages=messages or [])

    def upsert_thread(
        self,
        user_id: str,
        thread_id: str,
        *,
        title: str = "New chat",
        messages: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        path = self._thread_file(user_id, thread_id)
        timestamp = self._now()

        with self._lock:
            existing = self._read_thread_unlocked(path)
            created_at = existing.get("created_at") if existing else timestamp
            thread = {
                "user_id": user_id,
                "thread_id": thread_id,
                "title": title or "New chat",
                "messages": messages or [],
                "created_at": created_at,
                "updated_at": timestamp,
            }
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(thread, ensure_ascii=False, default=str), encoding="utf-8")

        return thread

    def get_thread(self, user_id: str, thread_id: str) -> dict[str, Any] | None:
        path = self._thread_file(user_id, thread_id)
        with self._lock:
            thread = self._read_thread_unlocked(path)
        return _normalize_thread(thread, user_id) if thread else None

    def list_threads(self, user_id: str) -> list[dict[str, Any]]:
        user_dir = self._user_dir(user_id)
        if not user_dir.exists():
            return []

        with self._lock:
            threads = [
                _normalize_thread(thread, user_id)
                for path in user_dir.glob("*.json")
                if (thread := self._read_thread_unlocked(path)) is not None
            ]

        return sorted(threads, key=lambda thread: thread.get("updated_at", ""), reverse=True)

    def _user_dir(self, user_id: str) -> Path:
        _validate_user_id(user_id)
        return self.base_dir / user_id

    def _thread_file(self, user_id: str, thread_id: str) -> Path:
        _validate_user_id(user_id)
        if not _SAFE_THREAD_ID.match(thread_id):
            raise ValueError(f"Invalid thread_id: {thread_id!r}")
        return self.base_dir / user_id / f"{thread_id}.json"

    @staticmethod
    def _now() -> str:
        return datetime.now(UTC).isoformat()

    @staticmethod
    def _read_thread_unlocked(path: Path) -> dict[str, Any] | None:
        if not path.exists():
            return None

        try:
            thread = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None

        return thread if isinstance(thread, dict) else None


class SupabaseResearchThreadStore:
    """Supabase-backed conversation thread storage."""

    def __init__(self, client: Client | None = None):
        self.supabase = client or _create_supabase_client()

    def create_thread(self, user_id: str, title: str = "New chat", messages: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        return self.upsert_thread(user_id, f"thread-{uuid.uuid4()}", title=title, messages=messages or [])

    def upsert_thread(
        self,
        user_id: str,
        thread_id: str,
        *,
        title: str = "New chat",
        messages: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        _validate_user_id(user_id)
        _validate_thread_id(thread_id)
        timestamp = _now()
        existing = self.get_thread(user_id, thread_id)
        created_at = existing.get("created_at") if existing else timestamp
        thread = {
            "user_id": user_id,
            "thread_id": thread_id,
            "title": title or "New chat",
            "messages": _jsonable(messages or []),
            "created_at": created_at,
            "updated_at": timestamp,
        }

        response = (
            self.supabase
            .table("research_threads")
            .upsert(thread, on_conflict="user_id,thread_id")
            .execute()
        )
        return _normalize_thread(_first_row(response.data) or thread, user_id)

    def get_thread(self, user_id: str, thread_id: str) -> dict[str, Any] | None:
        _validate_user_id(user_id)
        _validate_thread_id(thread_id)
        response = (
            self.supabase
            .table("research_threads")
            .select("*")
            .eq("user_id", user_id)
            .eq("thread_id", thread_id)
            .limit(1)
            .execute()
        )
        row = _first_row(response.data)
        return _normalize_thread(row, user_id) if row else None

    def list_threads(self, user_id: str) -> list[dict[str, Any]]:
        _validate_user_id(user_id)
        response = (
            self.supabase
            .table("research_threads")
            .select("*")
            .eq("user_id", user_id)
            .order("updated_at", desc=True)
            .execute()
        )
        return [_normalize_thread(row, user_id) for row in response.data or []]


def create_research_thread_store():
    settings = get_settings()
    if settings.research_storage_backend.lower() == "supabase":
        return SupabaseResearchThreadStore()
    return JsonResearchThreadStore()


def _create_supabase_client() -> Client:
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_service_key or settings.supabase_key)


def _validate_thread_id(thread_id: str) -> None:
    if not _SAFE_THREAD_ID.match(thread_id):
        raise ValueError(f"Invalid thread_id: {thread_id!r}")


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


def _normalize_thread(row: dict[str, Any], user_id: str) -> dict[str, Any]:
    return {
        "user_id": row.get("user_id") or user_id,
        "thread_id": row.get("thread_id", ""),
        "title": row.get("title") or "New chat",
        "messages": row.get("messages") if isinstance(row.get("messages"), list) else [],
        "created_at": row.get("created_at") or _now(),
        "updated_at": row.get("updated_at") or row.get("created_at") or _now(),
    }


research_thread_store = create_research_thread_store()
