"""SSE event stream for research execution."""

from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncIterator

from agents.nodes.analyze import stream_analyze_node
from agents.nodes.conversation_router import (
    answer_from_artifact_node,
    answer_sources_node,
    classify_research_intent_node,
    route_research_intent,
)
from agents.nodes.generate import stream_generate_node
from agents.nodes.web_search import web_search_node
from services.research_runs import JsonlResearchRunStore


def format_sse_event(event: str, data: dict[str, Any]) -> str:
    """Format a JSON payload as a Server-Sent Event."""
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\ndata: {payload}\n\n"


def _trace_event(
    stage: str,
    kind: str,
    title: str,
    detail: str,
    **extra: Any,
) -> dict[str, Any]:
    payload = {
        "id": f"{stage}-{kind}-{title}".lower().replace(" ", "-"),
        "stage": stage,
        "kind": kind,
        "title": title,
        "detail": detail,
    }
    payload.update(extra)
    return payload


def _document_trace_items(documents: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items = []

    for document in documents:
        metadata = document.get("metadata") if isinstance(document, dict) else {}
        metadata = metadata if isinstance(metadata, dict) else {}
        items.append(
            {
                "id": document.get("id"),
                "title": metadata.get("title") or _title_from_content(document.get("content", "")),
                "url": metadata.get("url"),
                "source": metadata.get("source"),
                "provider": metadata.get("provider"),
                "type": metadata.get("type"),
            }
        )

    return items


def _title_from_content(content: str) -> str:
    if not isinstance(content, str):
        return "Untitled source"
    if content.startswith("**"):
        end_index = content.find("**", 2)
        if end_index > 2:
            return content[2:end_index].strip() or "Untitled source"
    return content.splitlines()[0].strip()[:80] or "Untitled source"


async def stream_research_events(
    query: str,
    run_id: str | None = None,
    display_query: str | None = None,
    store: JsonlResearchRunStore | None = None,
    latest_result: dict[str, Any] | None = None,
) -> AsyncIterator[str]:
    """Run research and emit progress/result events as SSE strings."""
    visible_query = display_query or query
    state: dict[str, Any] = {
        "query": query,
        "display_query": visible_query,
        "documents": [],
        "analysis": None,
        "analysis_thinking": None,
        "report": None,
        "report_thinking": None,
        "latest_result": latest_result,
        "intent": None,
        "answer": None,
        "result_type": "report",
        "web_search_completed": False,
        "analysis_completed": False,
        "report_completed": False,
    }

    def record_event(event: str, data: dict[str, Any]) -> str:
        if run_id and store:
            store.append_event(run_id, event, data)
        return format_sse_event(event, data)

    try:
        state.update(await classify_research_intent_node(state))
        route = route_research_intent(state)

        if route == "answer_sources":
            yield record_event(
                "status",
                {
                    "stage": "analyze",
                    "label": "Answering",
                    "message": "Reading sources from the previous research report.",
                },
            )
            await asyncio.sleep(0)
            state.update(await answer_sources_node(state))
            yield record_event("answer", {"answer": state.get("answer")})
            await asyncio.sleep(0)
            yield record_event("complete", _result_payload(state))
            return

        if route == "answer_from_artifact":
            yield record_event(
                "status",
                {
                    "stage": "analyze",
                    "label": "Answering",
                    "message": "Using the previous research report as context.",
                },
            )
            await asyncio.sleep(0)
            state.update(await answer_from_artifact_node(state))
            if state.get("report_thinking"):
                yield record_event(
                    "thinking",
                    {
                        "id": "answer-thinking",
                        "stage": "report",
                        "label": "Answer thinking",
                        "text": state["report_thinking"],
                    },
                )
                await asyncio.sleep(0)
            yield record_event("answer", {"answer": state.get("answer")})
            await asyncio.sleep(0)
            yield record_event("complete", _result_payload(state))
            return

        yield record_event(
            "status",
            {
                "stage": "search",
                "label": "Searching",
                "message": "Searching the web for useful sources and context.",
            },
        )
        await asyncio.sleep(0)
        yield record_event(
            "trace",
            _trace_event(
                "search",
                "tool_call",
                "Search web",
                f"Searching public web sources for: {visible_query}",
                query=visible_query,
                tool="web_search",
            ),
        )
        await asyncio.sleep(0)
        state.update(await web_search_node(state))
        documents = state.get("documents", [])
        yield record_event("documents", {"documents": documents})
        await asyncio.sleep(0)
        yield record_event(
            "trace",
            _trace_event(
                "search",
                "tool_result",
                "Sources found",
                f"Found {len(documents)} source candidates.",
                tool="web_search",
                documents=_document_trace_items(documents),
            ),
        )
        await asyncio.sleep(0)

        if not state.get("documents"):
            state.update(
                {
                    "analysis": "No relevant documents found for the given query.",
                    "report": f"# Research Report: {visible_query}\n\nNo relevant documents found.",
                    "analysis_completed": True,
                    "report_completed": True,
                }
            )
            yield record_event("complete", _result_payload(state))
            return

        yield record_event(
            "status",
            {
                "stage": "analyze",
                "label": "Thinking",
                "message": "Reading sources and extracting key evidence.",
            },
        )
        await asyncio.sleep(0)
        yield record_event(
            "trace",
            _trace_event(
                "analyze",
                "reasoning",
                "Read sources",
                f"Reading {len(state.get('documents', []))} sources and comparing evidence.",
            ),
        )
        await asyncio.sleep(0)
        async for analysis_event in stream_analyze_node(state):
            if analysis_event.get("type") == "thinking":
                yield record_event("thinking", _thinking_payload(analysis_event))
                await asyncio.sleep(0)
            elif analysis_event.get("type") == "final":
                state.update(analysis_event.get("state", {}))
        yield record_event("analysis", {"analysis": state.get("analysis")})
        await asyncio.sleep(0)

        yield record_event(
            "status",
            {
                "stage": "report",
                "label": "Writing",
                "message": "Organizing findings into the final report.",
            },
        )
        await asyncio.sleep(0)
        yield record_event(
            "trace",
            _trace_event(
                "report",
                "reasoning",
                "Draft report",
                "Synthesizing findings into the final report artifact.",
            ),
        )
        await asyncio.sleep(0)
        async for report_event in stream_generate_node(state):
            if report_event.get("type") == "thinking":
                yield record_event("thinking", _thinking_payload(report_event))
                await asyncio.sleep(0)
            elif report_event.get("type") == "final":
                state.update(report_event.get("state", {}))
        yield record_event("report", {"report": state.get("report")})
        await asyncio.sleep(0)
        yield record_event("complete", _result_payload(state))
    except asyncio.CancelledError:
        if run_id and store:
            store.append_event(run_id, "stopped", {"status": "stopped"})
        raise
    except Exception as exc:
        yield record_event("stream_error", {"detail": f"Research execution failed: {exc}"})


def _result_payload(state: dict[str, Any]) -> dict[str, Any]:
    return {
        "query": state.get("display_query") or state["query"],
        "documents": state.get("documents", []),
        "analysis": state.get("analysis"),
        "analysis_thinking": state.get("analysis_thinking"),
        "report": state.get("report"),
        "report_thinking": state.get("report_thinking"),
        "answer": state.get("answer"),
        "result_type": state.get("result_type") or "report",
        "status": "completed" if state.get("report_completed") else "failed",
    }


def _thinking_payload(event: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": event.get("id") or f"{event.get('stage', 'report')}-thinking",
        "stage": event.get("stage"),
        "label": event.get("label") or "Thinking",
        "text": event.get("text") or "",
    }
