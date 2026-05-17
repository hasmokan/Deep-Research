"""SSE event stream for research execution."""

from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncIterator

from agents.nodes.analyze import analyze_node
from agents.nodes.generate import generate_node
from agents.nodes.web_search import web_search_node
from services.research_runs import JsonlResearchRunStore


def format_sse_event(event: str, data: dict[str, Any]) -> str:
    """Format a JSON payload as a Server-Sent Event."""
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\ndata: {payload}\n\n"


async def stream_research_events(
    query: str,
    run_id: str | None = None,
    display_query: str | None = None,
    store: JsonlResearchRunStore | None = None,
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
        "web_search_completed": False,
        "analysis_completed": False,
        "report_completed": False,
    }

    def record_event(event: str, data: dict[str, Any]) -> str:
        if run_id and store:
            store.append_event(run_id, event, data)
        return format_sse_event(event, data)

    try:
        yield record_event(
            "status",
            {
                "stage": "search",
                "label": "Searching",
                "message": "Searching the web for useful sources and context.",
            },
        )
        await asyncio.sleep(0)
        state.update(await web_search_node(state))
        yield record_event("documents", {"documents": state.get("documents", [])})
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
        state.update(await analyze_node(state))
        if state.get("analysis_thinking"):
            yield record_event(
                "thinking",
                {"stage": "analyze", "label": "Analysis thinking", "text": state["analysis_thinking"]},
            )
            await asyncio.sleep(0)
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
        state.update(await generate_node(state))
        if state.get("report_thinking"):
            yield record_event(
                "thinking",
                {"stage": "report", "label": "Report thinking", "text": state["report_thinking"]},
            )
            await asyncio.sleep(0)
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
        "status": "completed" if state.get("report_completed") else "failed",
    }
