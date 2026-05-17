"""Lightweight persistent storage for research run events."""

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


_SAFE_RUN_ID = re.compile(r"^[A-Za-z0-9_-]+$")


class JsonlResearchRunStore:
    """Append-only JSONL store with one file per research run."""

    def __init__(self, base_dir: str | Path | None = None):
        default_dir = Path(__file__).resolve().parents[1] / "data" / "runs"
        self.base_dir = Path(base_dir or os.getenv("RESEARCH_RUNS_DIR") or default_dir)
        self._lock = threading.Lock()

    def create_run(self, query: str) -> dict[str, Any]:
        run_id = f"run-{uuid.uuid4()}"
        timestamp = self._now()
        self.append_event(
            run_id,
            "metadata",
            {
                "run_id": run_id,
                "query": query,
                "status": "running",
                "created_at": timestamp,
            },
            created_at=timestamp,
        )
        return {
            "run_id": run_id,
            "query": query,
            "status": "running",
            "created_at": timestamp,
            "updated_at": timestamp,
        }

    def append_event(
        self,
        run_id: str,
        event: str,
        data: dict[str, Any],
        *,
        created_at: str | None = None,
    ) -> dict[str, Any]:
        path = self._run_file(run_id)
        timestamp = created_at or self._now()

        with self._lock:
            events = self._read_events_unlocked(path)
            record = {
                "run_id": run_id,
                "event": event,
                "data": data,
                "seq": len(events) + 1,
                "created_at": timestamp,
            }
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as file:
                file.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")

        return record

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        path = self._run_file(run_id)
        if not path.exists():
            return None

        events = self._read_events(path)
        if not events:
            return None

        metadata = next((event for event in events if event.get("event") == "metadata"), events[0])
        metadata_data = metadata.get("data") if isinstance(metadata.get("data"), dict) else {}
        status = self._derive_status(events)

        return {
            "run_id": run_id,
            "query": metadata_data.get("query", ""),
            "status": status,
            "created_at": metadata_data.get("created_at") or events[0].get("created_at"),
            "updated_at": events[-1].get("created_at"),
            "events": events,
        }

    def _run_file(self, run_id: str) -> Path:
        if not _SAFE_RUN_ID.match(run_id):
            raise ValueError(f"Invalid run_id: {run_id!r}")
        return self.base_dir / f"{run_id}.jsonl"

    @staticmethod
    def _now() -> str:
        return datetime.now(UTC).isoformat()

    def _read_events(self, path: Path) -> list[dict[str, Any]]:
        with self._lock:
            return self._read_events_unlocked(path)

    @staticmethod
    def _read_events_unlocked(path: Path) -> list[dict[str, Any]]:
        if not path.exists():
            return []

        events: list[dict[str, Any]] = []
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(event, dict):
                events.append(event)

        return sorted(events, key=lambda event: event.get("seq", 0))

    @staticmethod
    def _derive_status(events: list[dict[str, Any]]) -> str:
        for event in reversed(events):
            event_name = event.get("event")
            data = event.get("data") if isinstance(event.get("data"), dict) else {}
            if event_name == "stream_error":
                return "failed"
            if event_name == "stopped":
                return "stopped"
            if event_name == "complete":
                return str(data.get("status") or "completed")
        return "running"


class SupabaseResearchRunStore:
    """Supabase-backed research run event storage."""

    def __init__(self, client: Client | None = None):
        self.supabase = client or _create_supabase_client()

    def create_run(self, query: str) -> dict[str, Any]:
        run_id = f"run-{uuid.uuid4()}"
        timestamp = _now()
        run = {
            "run_id": run_id,
            "query": query,
            "status": "running",
            "created_at": timestamp,
            "updated_at": timestamp,
        }
        self.supabase.table("research_runs").insert(_jsonable(run)).execute()
        self.append_event(
            run_id,
            "metadata",
            {
                "run_id": run_id,
                "query": query,
                "status": "running",
                "created_at": timestamp,
            },
            created_at=timestamp,
        )
        return run

    def append_event(
        self,
        run_id: str,
        event: str,
        data: dict[str, Any],
        *,
        created_at: str | None = None,
    ) -> dict[str, Any]:
        _validate_run_id(run_id)
        timestamp = created_at or _now()
        seq = self._next_seq(run_id)
        record = {
            "run_id": run_id,
            "event": event,
            "data": _jsonable(data),
            "seq": seq,
            "created_at": timestamp,
        }
        response = self.supabase.table("research_run_events").insert(record).execute()
        saved_record = _first_row(response.data) or record
        self._touch_run(run_id, event, timestamp, data)
        return saved_record

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        _validate_run_id(run_id)
        run_response = (
            self.supabase
            .table("research_runs")
            .select("*")
            .eq("run_id", run_id)
            .limit(1)
            .execute()
        )
        run = _first_row(run_response.data)
        if not run:
            return None

        events_response = (
            self.supabase
            .table("research_run_events")
            .select("*")
            .eq("run_id", run_id)
            .order("seq")
            .execute()
        )
        events = [_normalize_event(event) for event in events_response.data or []]
        if not events:
            return None

        metadata = next((event for event in events if event.get("event") == "metadata"), events[0])
        metadata_data = metadata.get("data") if isinstance(metadata.get("data"), dict) else {}
        status = JsonlResearchRunStore._derive_status(events)

        return {
            "run_id": run_id,
            "query": run.get("query") or metadata_data.get("query", ""),
            "status": status,
            "created_at": run.get("created_at") or metadata_data.get("created_at") or events[0].get("created_at"),
            "updated_at": run.get("updated_at") or events[-1].get("created_at"),
            "events": events,
        }

    def _next_seq(self, run_id: str) -> int:
        response = (
            self.supabase
            .table("research_run_events")
            .select("seq")
            .eq("run_id", run_id)
            .order("seq", desc=True)
            .limit(1)
            .execute()
        )
        latest = _first_row(response.data)
        return int(latest.get("seq", 0)) + 1 if latest else 1

    def _touch_run(self, run_id: str, event: str, timestamp: str, data: dict[str, Any]) -> None:
        update = {"updated_at": timestamp}
        if event == "stream_error":
            update["status"] = "failed"
        elif event == "stopped":
            update["status"] = "stopped"
        elif event == "complete":
            update["status"] = str(data.get("status") or "completed")

        (
            self.supabase
            .table("research_runs")
            .update(update)
            .eq("run_id", run_id)
            .execute()
        )


def create_research_run_store():
    settings = get_settings()
    if settings.research_storage_backend.lower() == "supabase":
        return SupabaseResearchRunStore()
    return JsonlResearchRunStore()


def _create_supabase_client() -> Client:
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_service_key or settings.supabase_key)


def _validate_run_id(run_id: str) -> None:
    if not _SAFE_RUN_ID.match(run_id):
        raise ValueError(f"Invalid run_id: {run_id!r}")


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _jsonable(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False, default=str))


def _first_row(rows: Any) -> dict[str, Any] | None:
    if isinstance(rows, list) and rows:
        row = rows[0]
        return row if isinstance(row, dict) else None
    return None


def _normalize_event(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "run_id": row.get("run_id", ""),
        "event": row.get("event", ""),
        "data": row.get("data") if isinstance(row.get("data"), dict) else {},
        "seq": row.get("seq", 0),
        "created_at": row.get("created_at") or _now(),
    }


research_run_store = create_research_run_store()
