"""Optional Langfuse observability for research runs."""

from __future__ import annotations

from contextlib import nullcontext
from functools import lru_cache
from typing import Any

from core.config import get_settings


MAX_TEXT_CHARS = 4000
MAX_LIST_ITEMS = 20


class NoopObservation:
    """Context manager used when Langfuse is disabled or unavailable."""

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def update(self, **kwargs: Any) -> None:
        return None


class NoopLangfuseTracer:
    """No-op tracer with the same surface used by the research stream."""

    def start(self, name: str, **kwargs: Any) -> NoopObservation:
        return NoopObservation()

    def langchain_config(
        self,
        run_name: str,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return {}

    def propagate_attributes(self, **kwargs: Any):
        return nullcontext()

    def update_current_trace(self, **kwargs: Any) -> None:
        return None

    def score_current_trace(self, **kwargs: Any) -> None:
        return None

    def flush(self) -> None:
        return None

    def shutdown(self) -> None:
        return None


class LangfuseObservation:
    """Small safety wrapper around a Langfuse observation context."""

    def __init__(self, context: Any):
        self._context = context
        self._observation: Any | None = None

    def __enter__(self):
        self._observation = self._context.__enter__()
        return self

    def __exit__(self, exc_type, exc, traceback):
        return self._context.__exit__(exc_type, exc, traceback)

    def update(self, **kwargs: Any) -> None:
        if not self._observation:
            return
        try:
            self._observation.update(**_sanitize_mapping(kwargs))
        except Exception:
            return


class LangfuseTracer(NoopLangfuseTracer):
    """Lazy Langfuse client wrapper that keeps instrumentation optional."""

    def __init__(self, settings: Any | None = None):
        self._client: Any | None = None
        self._settings = settings or get_settings()

    @property
    def client(self) -> Any | None:
        if not self._settings.langfuse_enabled:
            return None

        if not self._settings.langfuse_public_key or not self._settings.langfuse_secret_key:
            return None

        if self._client is not None:
            return self._client

        try:
            from langfuse import Langfuse
        except Exception:
            return None

        kwargs: dict[str, Any] = {
            "environment": self._settings.langfuse_environment,
            "sample_rate": self._settings.langfuse_sample_rate,
        }
        optional_fields = {
            "public_key": self._settings.langfuse_public_key,
            "secret_key": self._settings.langfuse_secret_key,
            "base_url": self._settings.langfuse_base_url,
            "release": self._settings.langfuse_release,
        }
        kwargs.update({key: value for key, value in optional_fields.items() if value})

        try:
            self._client = Langfuse(**kwargs)
        except Exception:
            self._client = None

        return self._client

    def langchain_config(
        self,
        run_name: str,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if self.client is None:
            return {}

        callback_handler = _load_langchain_callback_handler()
        if callback_handler is None:
            return {}

        config: dict[str, Any] = {
            "callbacks": [callback_handler()],
            "run_name": run_name,
        }
        sanitized_metadata = _sanitize_mapping(metadata or {})
        if sanitized_metadata:
            config["metadata"] = sanitized_metadata

        return config

    def propagate_attributes(self, **kwargs: Any):
        if self.client is None:
            return nullcontext()

        propagate_attributes = _load_propagate_attributes()
        if propagate_attributes is None:
            return nullcontext()

        payload = {
            key: value
            for key, value in _sanitize_mapping(kwargs).items()
            if key in {"session_id", "user_id", "metadata", "tags"}
        }
        if not payload:
            return nullcontext()

        try:
            return propagate_attributes(**payload)
        except Exception:
            return nullcontext()

    def start(self, name: str, **kwargs: Any) -> NoopObservation | LangfuseObservation:
        client = self.client
        if client is None:
            return NoopObservation()

        payload = _sanitize_mapping(kwargs)
        start_kwargs = {
            key: value
            for key, value in payload.items()
            if key in {"as_type", "input", "model", "metadata"}
        }

        try:
            return LangfuseObservation(client.start_as_current_observation(name=name, **start_kwargs))
        except Exception:
            return NoopObservation()

    def update_current_trace(self, **kwargs: Any) -> None:
        client = self.client
        if client is None:
            return

        try:
            client.update_current_trace(**_sanitize_mapping(kwargs))
        except Exception:
            return

    def score_current_trace(self, **kwargs: Any) -> None:
        client = self.client
        if client is None:
            return

        try:
            client.score_current_trace(**_sanitize_mapping(kwargs))
        except Exception:
            return

    def flush(self) -> None:
        client = self.client
        if client is None:
            return

        try:
            client.flush()
        except Exception:
            return

    def shutdown(self) -> None:
        client = self.client
        if client is None:
            return

        try:
            client.shutdown()
        except Exception:
            return


@lru_cache
def get_langfuse_tracer() -> LangfuseTracer:
    return LangfuseTracer()


def _load_langchain_callback_handler():
    try:
        from langfuse.langchain import CallbackHandler
    except Exception:
        return None

    return CallbackHandler


def _load_propagate_attributes():
    try:
        from langfuse import propagate_attributes
    except Exception:
        return None

    return propagate_attributes


def sanitize_observation_payload(value: Any) -> Any:
    return _sanitize_value(value)


async def ainvoke_langchain(chain: Any, payload: dict[str, Any], config: dict[str, Any]):
    if not config:
        return await chain.ainvoke(payload)

    try:
        invocation = chain.ainvoke(payload, config=config)
    except TypeError as exc:
        if not _is_config_argument_error(exc):
            raise
        invocation = chain.ainvoke(payload)

    return await invocation


def astream_langchain(chain: Any, payload: dict[str, Any], config: dict[str, Any]):
    if not config:
        return chain.astream(payload)

    try:
        return chain.astream(payload, config=config)
    except TypeError as exc:
        if not _is_config_argument_error(exc):
            raise
        return chain.astream(payload)


def _is_config_argument_error(exc: TypeError) -> bool:
    return "config" in str(exc) and "unexpected keyword argument" in str(exc)


def _sanitize_mapping(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: _sanitize_value(value) for key, value in payload.items() if value is not None}


def _sanitize_value(value: Any) -> Any:
    if isinstance(value, str):
        if len(value) <= MAX_TEXT_CHARS:
            return value
        return f"{value[:MAX_TEXT_CHARS]}... [truncated {len(value) - MAX_TEXT_CHARS} chars]"

    if isinstance(value, list):
        return [_sanitize_value(item) for item in value[:MAX_LIST_ITEMS]]

    if isinstance(value, tuple):
        return tuple(_sanitize_value(item) for item in value[:MAX_LIST_ITEMS])

    if isinstance(value, dict):
        return {
            str(key): _sanitize_value(item)
            for key, item in list(value.items())[:MAX_LIST_ITEMS]
        }

    return value
