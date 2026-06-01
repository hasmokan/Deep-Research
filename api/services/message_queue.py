"""Research job message queue backends."""

from __future__ import annotations

import asyncio
import json
import os
import socket
from dataclasses import asdict, dataclass
from typing import Any, Callable, Optional
from uuid import uuid4


def _default_consumer_name() -> str:
    return f"{socket.gethostname()}:{os.getpid()}:{uuid4().hex[:8]}"


@dataclass(frozen=True)
class ResearchRunJob:
    contextual_query: str
    run_id: str
    user_id: str
    thread_id: Optional[str] = None
    trace_id: Optional[str] = None
    display_query: Optional[str] = None
    latest_result: Optional[dict[str, Any]] = None
    execution_mode: str = "auto"


@dataclass(frozen=True)
class QueuedResearchRunJob:
    job: ResearchRunJob
    message_id: Optional[str] = None


class MemoryResearchJobQueue:
    """In-process research job queue for local development and tests."""

    def __init__(self) -> None:
        self._queue: asyncio.Queue[ResearchRunJob] = asyncio.Queue()

    async def start(self) -> None:
        return None

    async def close(self) -> None:
        return None

    async def send(self, job: ResearchRunJob) -> None:
        await self._queue.put(job)

    async def receive(self) -> QueuedResearchRunJob:
        return QueuedResearchRunJob(job=await self._queue.get())

    async def ack(self, queued: QueuedResearchRunJob) -> None:
        del queued
        self._queue.task_done()


class RedisResearchJobQueue:
    """Redis Streams research job queue."""

    def __init__(
        self,
        *,
        redis_url: str,
        stream_name: str = "deep-research:jobs",
        group_name: str = "deep-research-workers",
        consumer_name: str | None = None,
        read_block_ms: int = 1000,
        redis_factory: Callable[[str], Any] | None = None,
    ) -> None:
        self.redis_url = redis_url
        self.stream_name = stream_name
        self.group_name = group_name
        self.consumer_name = consumer_name or _default_consumer_name()
        self.read_block_ms = read_block_ms
        self._redis_factory = redis_factory
        self._redis: Any | None = None
        self._group_ready = False

    async def start(self) -> None:
        await self._ensure_group()

    async def close(self) -> None:
        if self._redis is not None:
            await self._redis.aclose()
            self._redis = None
        self._group_ready = False

    async def send(self, job: ResearchRunJob) -> None:
        redis = await self._get_redis()
        await redis.xadd(self.stream_name, {"payload": json.dumps(asdict(job), ensure_ascii=False, separators=(",", ":"))})

    async def receive(self) -> QueuedResearchRunJob:
        await self._ensure_group()
        redis = await self._get_redis()

        while True:
            entries = await redis.xreadgroup(
                groupname=self.group_name,
                consumername=self.consumer_name,
                streams={self.stream_name: ">"},
                count=1,
                block=self.read_block_ms,
            )
            if not entries:
                await asyncio.sleep(0)
                continue

            for _stream_name, messages in entries:
                for message_id, fields in messages:
                    payload = _decode_redis_value(fields.get("payload") if isinstance(fields, dict) else None)
                    if not isinstance(payload, str):
                        await redis.xack(self.stream_name, self.group_name, message_id)
                        continue
                    try:
                        data = json.loads(payload)
                        if not isinstance(data, dict):
                            raise ValueError("payload must be a JSON object")
                        return QueuedResearchRunJob(
                            job=ResearchRunJob(**data),
                            message_id=str(_decode_redis_value(message_id)),
                        )
                    except Exception:
                        await redis.xack(self.stream_name, self.group_name, message_id)

    async def ack(self, queued: QueuedResearchRunJob) -> None:
        if not queued.message_id:
            return
        redis = await self._get_redis()
        await redis.xack(self.stream_name, self.group_name, queued.message_id)

    async def _get_redis(self):
        if self._redis is not None:
            return self._redis
        if self._redis_factory is not None:
            self._redis = self._redis_factory(self.redis_url)
            return self._redis

        import redis.asyncio as redis

        self._redis = redis.from_url(self.redis_url, decode_responses=True)
        return self._redis

    async def _ensure_group(self) -> None:
        if self._group_ready:
            return
        redis = await self._get_redis()
        try:
            await redis.xgroup_create(
                name=self.stream_name,
                groupname=self.group_name,
                id="0-0",
                mkstream=True,
            )
        except Exception as exc:
            if "BUSYGROUP" not in str(exc):
                raise
        self._group_ready = True


def create_research_job_queue(settings: Any | None = None):
    if settings is None:
        from core.config import get_settings

        settings = get_settings()

    backend = str(getattr(settings, "research_queue_backend", "memory") or "memory").strip().lower()
    if backend in {"memory", "in_memory", ""}:
        return MemoryResearchJobQueue()
    if backend != "redis":
        raise ValueError(f"Unsupported research queue backend: {backend!r}")

    redis_url = getattr(settings, "redis_url", None)
    if not isinstance(redis_url, str) or not redis_url.strip():
        raise ValueError("REDIS_URL is required when RESEARCH_QUEUE_BACKEND=redis")

    return RedisResearchJobQueue(
        redis_url=redis_url.strip(),
        stream_name=getattr(settings, "research_queue_stream", "deep-research:jobs"),
        group_name=getattr(settings, "research_queue_group", "deep-research-workers"),
        consumer_name=getattr(settings, "research_queue_consumer", None) or None,
    )


def _decode_redis_value(value: Any) -> Any:
    if isinstance(value, bytes):
        return value.decode("utf-8")
    return value
