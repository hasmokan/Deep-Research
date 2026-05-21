"""SSE event stream for research execution."""

from __future__ import annotations

import asyncio
import inspect
import json
from typing import Any, AsyncIterator

from agents.react_agent import stream_react_agent_messages
from agents.nodes.analyze import stream_analyze_node
from agents.nodes.conversation_router import (
    answer_from_artifact_node,
    answer_sources_node,
    classify_research_intent_node,
    route_research_intent,
    stream_answer_coding_node,
    stream_answer_direct_node,
)
from agents.nodes.generate import stream_generate_node
from agents.nodes.web_search import web_search_node
from core.config import get_settings
from services.langfuse_observability import get_langfuse_tracer


settings = get_settings()


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
    store: Any | None = None,
    latest_result: dict[str, Any] | None = None,
    execution_mode: str = "auto",
    on_complete: Any | None = None,
) -> AsyncIterator[str]:
    """Run research and emit progress/result events as SSE strings."""
    visible_query = display_query or query
    tracer = get_langfuse_tracer()
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

    async def complete_event(result_payload: dict[str, Any]) -> str:
        if on_complete:
            maybe_result = on_complete(result_payload)
            if inspect.isawaitable(maybe_result):
                await maybe_result
        return record_event("complete", result_payload)

    with tracer.start(
        "research-run",
        as_type="agent",
        input={
            "query": visible_query,
            "contextual_query": query,
        },
        metadata={
            "run_id": run_id,
            "has_latest_result": bool(latest_result),
        },
    ) as run_observation, tracer.propagate_attributes(
        session_id=run_id,
        tags=["deep-research", "sse"],
    ):
        tracer.update_current_trace(
            name=f"research: {visible_query[:80]}",
            session_id=run_id,
            tags=["deep-research", "sse"],
            metadata={
                "run_id": run_id,
                "display_query": visible_query,
                "has_latest_result": bool(latest_result),
            },
        )

        try:
            yield record_event(
                "status",
                {
                    "stage": "route",
                    "label": "Understanding",
                    "message": "Classifying the request.",
                },
            )
            await asyncio.sleep(0)
            with tracer.start(
                "intent-routing",
                as_type="span",
                input={
                    "query": visible_query,
                    "has_latest_result": bool(latest_result),
                },
                metadata={"run_id": run_id},
            ) as intent_observation:
                state.update(await classify_research_intent_node(state))
                route = route_research_intent(state)
                intent_observation.update(output={
                    "intent": state.get("intent"),
                    "route": route,
                    "reason": state.get("reason"),
                })

            if route == "answer_coding":
                yield record_event(
                    "status",
                    {
                        "stage": "coding",
                        "label": "Solving",
                        "message": "Writing a direct coding answer.",
                    },
                )
                await asyncio.sleep(0)
                with tracer.start(
                    "coding-answer-llm",
                    as_type="span",
                    input={"query": visible_query},
                    metadata={"run_id": run_id},
                ) as answer_observation:
                    async for answer_event in stream_answer_coding_node(state):
                        if answer_event.get("type") == "answer_delta":
                            yield record_event("answer_delta", {"delta": answer_event.get("delta") or ""})
                            await asyncio.sleep(0)
                        elif answer_event.get("type") == "trace":
                            yield record_event(
                                "trace",
                                _trace_event(
                                    answer_event.get("stage") or "coding",
                                    answer_event.get("kind") or "tool_call",
                                    answer_event.get("title") or "Sandbox tool",
                                    answer_event.get("detail") or "",
                                    **{
                                        key: value
                                        for key, value in answer_event.items()
                                        if key
                                        not in {
                                            "type",
                                            "stage",
                                            "kind",
                                            "title",
                                            "detail",
                                        }
                                    },
                                ),
                            )
                            await asyncio.sleep(0)
                        elif answer_event.get("type") == "thinking":
                            yield record_event(
                                "thinking",
                                {
                                    "id": answer_event.get("id") or "coding-thinking",
                                    "stage": answer_event.get("stage") or "coding",
                                    "label": answer_event.get("label") or "Solution thinking",
                                    "text": answer_event.get("text") or "",
                                },
                            )
                            await asyncio.sleep(0)
                        elif answer_event.get("type") == "final":
                            state.update(answer_event.get("state", {}))
                    answer_observation.update(output={
                        "answer_preview": _text_preview(state.get("answer")),
                        "thinking_preview": _text_preview(state.get("report_thinking")),
                    })
                yield record_event("answer", {"answer": state.get("answer")})
                await asyncio.sleep(0)
                result_payload = _result_payload(state)
                run_observation.update(output=_result_observability_summary(result_payload))
                yield await complete_event(result_payload)
                return

            if execution_mode == "react" and route in {"answer_direct", "web_search"}:
                yield record_event(
                    "status",
                    {
                        "stage": "react",
                        "label": "Reasoning",
                        "message": "Running a ReAct agent with tools.",
                    },
                )
                await asyncio.sleep(0)
                with tracer.start(
                    "react-agent",
                    as_type="agent",
                    input={"query": visible_query, "route": route},
                    metadata={"run_id": run_id},
                ) as react_observation:
                    emitted_answer = False
                    async for react_event in stream_react_agent_messages(query):
                        event_type = react_event.get("type")
                        if event_type == "agent_message":
                            message = react_event.get("message") if isinstance(react_event.get("message"), dict) else {}
                            yield record_event("agent_message", message)
                            _merge_react_documents(state, message)
                            await asyncio.sleep(0)
                        elif event_type == "clarification":
                            question = str(react_event.get("question") or react_event.get("message") or "").strip()
                            state.update(
                                {
                                    "answer": question,
                                    "result_type": "answer",
                                    "report_completed": True,
                                }
                            )
                            yield record_event("answer", {"answer": state.get("answer")})
                            emitted_answer = True
                            await asyncio.sleep(0)
                            break
                        elif event_type == "final":
                            state.update(
                                {
                                    "answer": str(react_event.get("answer") or "").strip(),
                                    "result_type": "answer",
                                    "report_completed": True,
                                }
                            )
                    react_observation.update(output={
                        "answer_preview": _text_preview(state.get("answer")),
                        "documents": _documents_observability_items(state.get("documents", [])),
                    })
                if state.get("answer") is not None and not emitted_answer:
                    yield record_event("answer", {"answer": state.get("answer")})
                    await asyncio.sleep(0)
                result_payload = _result_payload(state)
                run_observation.update(output=_result_observability_summary(result_payload))
                yield await complete_event(result_payload)
                return

            if route == "answer_direct":
                yield record_event(
                    "status",
                    {
                        "stage": "answer",
                        "label": "Answering",
                        "message": "Answering directly without a research run.",
                    },
                )
                await asyncio.sleep(0)
                with tracer.start(
                    "direct-answer-llm",
                    as_type="span",
                    input={"query": visible_query},
                    metadata={"run_id": run_id},
                ) as answer_observation:
                    async for answer_event in stream_answer_direct_node(state):
                        if answer_event.get("type") == "answer_delta":
                            yield record_event("answer_delta", {"delta": answer_event.get("delta") or ""})
                            await asyncio.sleep(0)
                        elif answer_event.get("type") == "thinking":
                            yield record_event(
                                "thinking",
                                {
                                    "id": answer_event.get("id") or "direct-answer-thinking",
                                    "stage": answer_event.get("stage") or "answer",
                                    "label": answer_event.get("label") or "Answer thinking",
                                    "text": answer_event.get("text") or "",
                                },
                            )
                            await asyncio.sleep(0)
                        elif answer_event.get("type") == "final":
                            state.update(answer_event.get("state", {}))
                    answer_observation.update(output={
                        "answer_preview": _text_preview(state.get("answer")),
                        "thinking_preview": _text_preview(state.get("report_thinking")),
                    })
                yield record_event("answer", {"answer": state.get("answer")})
                await asyncio.sleep(0)
                result_payload = _result_payload(state)
                run_observation.update(output=_result_observability_summary(result_payload))
                yield await complete_event(result_payload)
                return

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
                with tracer.start(
                    "answer-sources",
                    as_type="span",
                    input={
                        "query": visible_query,
                        "documents_count": len((latest_result or {}).get("documents", [])),
                    },
                    metadata={"run_id": run_id},
                ) as answer_observation:
                    state.update(await answer_sources_node(state))
                    answer_observation.update(output={
                        "answer_preview": _text_preview(state.get("answer")),
                        "documents": _documents_observability_items(state.get("documents", [])),
                    })
                yield record_event("answer", {"answer": state.get("answer")})
                await asyncio.sleep(0)
                result_payload = _result_payload(state)
                run_observation.update(output=_result_observability_summary(result_payload))
                yield await complete_event(result_payload)
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
                with tracer.start(
                    "artifact-follow-up-llm",
                    as_type="span",
                    input={
                        "query": visible_query,
                        "report_preview": _text_preview((latest_result or {}).get("report")),
                    },
                    metadata={"run_id": run_id},
                ) as answer_observation:
                    state.update(await answer_from_artifact_node(state))
                    answer_observation.update(output={
                        "answer_preview": _text_preview(state.get("answer")),
                        "thinking_preview": _text_preview(state.get("report_thinking")),
                    })
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
                result_payload = _result_payload(state)
                run_observation.update(output=_result_observability_summary(result_payload))
                yield await complete_event(result_payload)
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
            search_tool_call_id = f"web-search-{run_id or 'live'}"
            yield record_event(
                "agent_message",
                _agent_ai_message(
                    "search-reasoning",
                    "Searching public web sources before answering.",
                    [
                        {
                            "id": search_tool_call_id,
                            "name": "web_search",
                            "args": {"query": visible_query},
                        }
                    ],
                ),
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
            with tracer.start(
                "web-search",
                as_type="tool",
                input={
                    "query": visible_query,
                    "contextual_query": query,
                    "provider": "duckduckgo",
                },
                metadata={"run_id": run_id},
            ) as search_observation:
                state.update(await web_search_node(state))
                documents = state.get("documents", [])
                search_observation.update(output={
                    "documents_count": len(documents),
                    "documents": _documents_observability_items(documents),
                })
            yield record_event("documents", {"documents": documents})
            await asyncio.sleep(0)
            yield record_event(
                "agent_message",
                _agent_tool_message(
                    search_tool_call_id,
                    "web_search",
                    _agent_tool_content(_document_trace_items(documents)),
                ),
            )
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
                result_payload = _result_payload(state)
                run_observation.update(output=_result_observability_summary(result_payload))
                yield await complete_event(result_payload)
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
            with tracer.start(
                "analyze-llm",
                as_type="span",
                input={
                    "query": visible_query,
                    "contextual_query": query,
                    "documents_count": len(state.get("documents", [])),
                    "documents": _documents_observability_items(state.get("documents", [])),
                },
                metadata={"run_id": run_id},
            ) as analyze_observation:
                async for analysis_event in stream_analyze_node(state):
                    if analysis_event.get("type") in {"thinking", "draft"}:
                        yield record_event("thinking", _thinking_payload(analysis_event))
                        await asyncio.sleep(0)
                    elif analysis_event.get("type") == "final":
                        state.update(analysis_event.get("state", {}))
                analyze_observation.update(output={
                    "analysis_preview": _text_preview(state.get("analysis")),
                    "thinking_preview": _text_preview(state.get("analysis_thinking")),
                })
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
            with tracer.start(
                "report-llm",
                as_type="span",
                input={
                    "query": visible_query,
                    "analysis_preview": _text_preview(state.get("analysis")),
                    "documents_count": len(state.get("documents", [])),
                },
                metadata={"run_id": run_id},
            ) as report_observation:
                async for report_event in stream_generate_node(state):
                    if report_event.get("type") in {"thinking", "draft"}:
                        yield record_event("thinking", _thinking_payload(report_event))
                        await asyncio.sleep(0)
                    elif report_event.get("type") == "final":
                        state.update(report_event.get("state", {}))
                report_observation.update(output={
                    "report_preview": _text_preview(state.get("report")),
                    "thinking_preview": _text_preview(state.get("report_thinking")),
                })
            yield record_event("report", {"report": state.get("report")})
            await asyncio.sleep(0)
            result_payload = _result_payload(state)
            run_observation.update(output=_result_observability_summary(result_payload))
            yield await complete_event(result_payload)
        except asyncio.CancelledError:
            run_observation.update(output={"status": "stopped"})
            if run_id and store:
                store.append_event(run_id, "stopped", {"status": "stopped"})
            raise
        except Exception as exc:
            run_observation.update(output={
                "status": "failed",
                "error": str(exc),
            })
            yield record_event("stream_error", {"detail": f"Research execution failed: {exc}"})
        finally:
            tracer.flush()


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


def _agent_ai_message(
    message_id: str,
    reasoning_content: str,
    tool_calls: list[dict[str, Any]] | None = None,
    content: str = "",
) -> dict[str, Any]:
    return {
        "type": "ai",
        "id": message_id,
        "content": content,
        "reasoning_content": reasoning_content,
        "tool_calls": tool_calls or [],
    }


def _agent_tool_message(tool_call_id: str, name: str, content: str) -> dict[str, Any]:
    return {
        "type": "tool",
        "id": f"tool-{tool_call_id}",
        "tool_call_id": tool_call_id,
        "name": name,
        "content": content,
    }


def _agent_tool_content(value: Any) -> str:
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False)


def _merge_react_documents(state: dict[str, Any], message: dict[str, Any]) -> None:
    if message.get("type") != "tool" or message.get("name") != "web_search":
        return

    content = message.get("content")
    if not isinstance(content, str):
        return

    try:
        items = json.loads(content)
    except json.JSONDecodeError:
        return

    if not isinstance(items, list):
        return

    existing = state.setdefault("documents", [])
    existing_urls = {
        ((document.get("metadata") or {}).get("url"))
        for document in existing
        if isinstance(document, dict) and isinstance(document.get("metadata"), dict)
    }

    for item in items:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or item.get("url") or "Untitled source").strip()
        url = str(item.get("url") or "").strip()
        if url and url in existing_urls:
            continue
        existing.append(
            {
                "id": f"react_{len(existing)}",
                "content": title,
                "metadata": {
                    "title": title,
                    "url": url or None,
                    "source": item.get("source"),
                    "provider": "react",
                    "type": "web_search",
                },
                "similarity": None,
            }
        )
        if url:
            existing_urls.add(url)


def _documents_observability_items(documents: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items = []

    for document in documents[:10]:
        metadata = document.get("metadata") if isinstance(document, dict) else {}
        metadata = metadata if isinstance(metadata, dict) else {}
        items.append({
            "id": document.get("id"),
            "title": metadata.get("title") or _title_from_content(document.get("content", "")),
            "url": metadata.get("url"),
            "source": metadata.get("source"),
            "provider": metadata.get("provider"),
            "type": metadata.get("type"),
            "rank_score": metadata.get("rank_score"),
        })

    return items


def _result_observability_summary(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": result.get("status"),
        "result_type": result.get("result_type"),
        "query": result.get("query"),
        "documents_count": len(result.get("documents") or []),
        "answer_preview": _text_preview(result.get("answer")),
        "analysis_preview": _text_preview(result.get("analysis")),
        "report_preview": _text_preview(result.get("report")),
    }


def _text_preview(value: Any, limit: int = 1600) -> str | None:
    if value is None:
        return None

    text = str(value)
    if len(text) <= limit:
        return text
    return f"{text[:limit]}... [truncated {len(text) - limit} chars]"
