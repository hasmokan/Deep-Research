"""Request trace IDs and structured application logging."""

from __future__ import annotations

import contextvars
import json
import logging
import re
import time
import uuid
from collections.abc import Callable
from typing import Any

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


REQUEST_ID_HEADER = "X-Request-ID"
MAX_LOG_VALUE_CHARS = 2000
_SENSITIVE_FIELD = re.compile(r"(authorization|password|secret|token|api[_-]?key|cookie)", re.IGNORECASE)

_request_id: contextvars.ContextVar[str | None] = contextvars.ContextVar("request_id", default=None)
_logger = logging.getLogger("deep_research")


class JsonLogFormatter(logging.Formatter):
    """Format application log records as compact JSON lines."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        event_payload = getattr(record, "event_payload", None)
        if isinstance(event_payload, dict):
            payload.update(_sanitize_log_value(event_payload))

        return json.dumps(payload, ensure_ascii=False, default=str, separators=(",", ":"))


def configure_logging() -> None:
    """Configure the app logger once without taking over third-party loggers."""
    if any(getattr(handler, "_deep_research_json", False) for handler in _logger.handlers):
        return

    handler = logging.StreamHandler()
    handler.setFormatter(JsonLogFormatter())
    handler._deep_research_json = True  # type: ignore[attr-defined]
    _logger.addHandler(handler)
    _logger.setLevel(logging.INFO)
    _logger.propagate = False


def current_request_id() -> str | None:
    return _request_id.get()


def set_request_id(request_id: str | None):
    return _request_id.set(request_id)


def reset_request_id(token: contextvars.Token[str | None]) -> None:
    _request_id.reset(token)


def new_request_id() -> str:
    return f"req-{uuid.uuid4()}"


def log_event(event: str, *, level: int = logging.INFO, **fields: Any) -> None:
    payload = {
        "event": event,
        "request_id": current_request_id(),
        **fields,
    }
    _logger.log(level, event, extra={"event_payload": payload})


class RequestTracingMiddleware(BaseHTTPMiddleware):
    """Attach a request ID to every HTTP request and emit structured access logs."""

    async def dispatch(self, request: Request, call_next: Callable[[Request], Any]) -> Response:
        incoming_request_id = request.headers.get(REQUEST_ID_HEADER)
        request_id = _normalize_request_id(incoming_request_id) or new_request_id()
        token = set_request_id(request_id)
        started = time.perf_counter()

        log_event(
            "http_request_started",
            method=request.method,
            path=request.url.path,
            client=_client_host(request),
        )

        try:
            response = await call_next(request)
        except Exception as exc:
            duration_ms = round((time.perf_counter() - started) * 1000, 2)
            log_event(
                "http_request_failed",
                level=logging.ERROR,
                method=request.method,
                path=request.url.path,
                duration_ms=duration_ms,
                error_type=type(exc).__name__,
                error=str(exc),
            )
            raise
        finally:
            reset_request_id(token)

        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        response.headers[REQUEST_ID_HEADER] = request_id
        log_event(
            "http_request_completed",
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            duration_ms=duration_ms,
        )
        return response


def _normalize_request_id(value: str | None) -> str | None:
    if not value:
        return None
    normalized = "".join(
        character
        for character in value.strip()
        if character.isalnum() or character in {"-", "_", ".", ":"}
    )
    if not normalized:
        return None
    return normalized[:120]


def _client_host(request: Request) -> str | None:
    return request.client.host if request.client else None


def _sanitize_log_value(value: Any) -> Any:
    if isinstance(value, dict):
        sanitized = {}
        for key, item in list(value.items())[:50]:
            key_text = str(key)
            if _SENSITIVE_FIELD.search(key_text):
                sanitized[key_text] = "[redacted]"
                continue
            sanitized[key_text] = _sanitize_log_value(item)
        return sanitized
    if isinstance(value, list):
        return [_sanitize_log_value(item) for item in value[:50]]
    if isinstance(value, str):
        return value if len(value) <= MAX_LOG_VALUE_CHARS else f"{value[:MAX_LOG_VALUE_CHARS]}... [truncated]"
    return value
