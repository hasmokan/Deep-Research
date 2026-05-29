"""LangGraph checkpoint saver selection."""

from __future__ import annotations

import atexit
from typing import Any

from core.config import get_settings
from langgraph.checkpoint.memory import MemorySaver


_ACTIVE_CONTEXTS: list[Any] = []


def create_langgraph_checkpointer(settings: Any | None = None) -> Any:
    """Create the configured LangGraph checkpointer.

    The default stays in-process for local development and tests. Production can
    set LANGGRAPH_CHECKPOINT_BACKEND=postgres with a direct Supabase Postgres
    connection URL.
    """
    resolved_settings = settings or get_settings()
    backend = str(getattr(resolved_settings, "langgraph_checkpoint_backend", "memory") or "memory").lower()

    if backend in {"memory", "inmemory", "in_memory"}:
        return MemorySaver()

    if backend in {"postgres", "postgresql", "supabase"}:
        return _create_postgres_checkpointer(resolved_settings)

    raise ValueError(f"Unsupported LangGraph checkpoint backend: {backend!r}")


def close_langgraph_checkpointers() -> None:
    """Close context-managed checkpointers created by this module."""
    while _ACTIVE_CONTEXTS:
        context = _ACTIVE_CONTEXTS.pop()
        context.__exit__(None, None, None)


def _create_postgres_checkpointer(settings: Any) -> Any:
    postgres_url = getattr(settings, "langgraph_checkpoint_postgres_url", None)
    if not postgres_url:
        raise ValueError("LANGGRAPH_CHECKPOINT_POSTGRES_URL is required for Postgres/Supabase LangGraph checkpoints")

    postgres_saver = _load_postgres_saver()
    context = postgres_saver.from_conn_string(postgres_url)
    checkpointer = context.__enter__()

    try:
        if getattr(settings, "langgraph_checkpoint_setup", True):
            checkpointer.setup()
    except BaseException as exc:
        context.__exit__(type(exc), exc, exc.__traceback__)
        raise

    _ACTIVE_CONTEXTS.append(context)
    return checkpointer


def _load_postgres_saver() -> Any:
    try:
        from langgraph.checkpoint.postgres import PostgresSaver
    except ImportError as exc:
        raise RuntimeError(
            "Postgres LangGraph checkpoints require langgraph-checkpoint-postgres "
            "and psycopg. Install the API requirements before enabling "
            "LANGGRAPH_CHECKPOINT_BACKEND=postgres."
        ) from exc

    return PostgresSaver


atexit.register(close_langgraph_checkpointers)
