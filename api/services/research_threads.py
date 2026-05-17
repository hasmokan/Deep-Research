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


_SAFE_THREAD_ID = re.compile(r"^[A-Za-z0-9_-]+$")


class JsonResearchThreadStore:
    """One JSON document per conversation thread."""

    def __init__(self, base_dir: str | Path | None = None):
        default_dir = Path(__file__).resolve().parents[1] / "data" / "threads"
        self.base_dir = Path(base_dir or os.getenv("RESEARCH_THREADS_DIR") or default_dir)
        self._lock = threading.Lock()

    def create_thread(self, title: str = "New chat", messages: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        return self.upsert_thread(f"thread-{uuid.uuid4()}", title=title, messages=messages or [])

    def upsert_thread(
        self,
        thread_id: str,
        *,
        title: str = "New chat",
        messages: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        path = self._thread_file(thread_id)
        timestamp = self._now()

        with self._lock:
            existing = self._read_thread_unlocked(path)
            created_at = existing.get("created_at") if existing else timestamp
            thread = {
                "thread_id": thread_id,
                "title": title or "New chat",
                "messages": messages or [],
                "created_at": created_at,
                "updated_at": timestamp,
            }
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(thread, ensure_ascii=False, default=str), encoding="utf-8")

        return thread

    def get_thread(self, thread_id: str) -> dict[str, Any] | None:
        path = self._thread_file(thread_id)
        with self._lock:
            return self._read_thread_unlocked(path)

    def list_threads(self) -> list[dict[str, Any]]:
        if not self.base_dir.exists():
            return []

        with self._lock:
            threads = [
                thread
                for path in self.base_dir.glob("*.json")
                if (thread := self._read_thread_unlocked(path)) is not None
            ]

        return sorted(threads, key=lambda thread: thread.get("updated_at", ""), reverse=True)

    def _thread_file(self, thread_id: str) -> Path:
        if not _SAFE_THREAD_ID.match(thread_id):
            raise ValueError(f"Invalid thread_id: {thread_id!r}")
        return self.base_dir / f"{thread_id}.json"

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


research_thread_store = JsonResearchThreadStore()
