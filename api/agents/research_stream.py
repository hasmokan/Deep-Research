"""SSE event stream for research execution."""

from __future__ import annotations

import asyncio
import inspect
import json
from typing import Any, AsyncIterator, TypedDict

from langgraph.graph import END, StateGraph

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
from agents.nodes.query_resolution import resolve_research_query_node
from agents.nodes.web_search import web_search_node
from services.langfuse_observability import get_langfuse_tracer


research_agent: Any | None = None


class StreamingResearchState(TypedDict, total=False):
    query: str
    display_query: str
    documents: list[dict[str, Any]]
    analysis: str | None
    analysis_thinking: str | None
    report: str | None
    report_thinking: str | None
    latest_result: dict[str, Any] | None
    resolved_query: str | None
    search_query: str | None
    context_resolution: dict[str, Any] | None
    intent: str | None
    route: str | None
    graph_route: str | None
    reason: str | None
    answer: str | None
    result_type: str | None
    execution_mode: str
    stream_events: list[dict[str, Any]]
    run_id: str | None
    web_search_completed: bool
    analysis_completed: bool
    report_completed: bool


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
        "resolved_query": None,
        "search_query": None,
        "context_resolution": None,
        "intent": None,
        "route": None,
        "graph_route": None,
        "answer": None,
        "result_type": "report",
        "run_id": run_id,
        "execution_mode": execution_mode,
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

    async for event in _stream_langgraph_research_events(
        state,
        visible_query=visible_query,
        contextual_query=query,
        run_id=run_id,
        latest_result=latest_result,
        execution_mode=execution_mode,
        tracer=tracer,
        record_event=record_event,
        complete_event=complete_event,
    ):
        yield event
    return


def build_streaming_research_graph() -> Any:
    """Build the LangGraph workflow that drives the SSE research runtime."""
    graph = StateGraph(StreamingResearchState)

    graph.add_node("resolve_query", resolve_research_query_node)
    graph.add_node("classify_intent", _classify_streaming_intent_node)
    graph.add_node("answer_sources", _streaming_answer_sources_node)
    graph.add_node("answer_from_artifact", _streaming_answer_from_artifact_node)
    graph.add_node("answer_coding", _streaming_answer_coding_node)
    graph.add_node("answer_direct", _streaming_answer_direct_node)
    graph.add_node("answer_react", _streaming_answer_react_node)
    graph.add_node("web_search", _streaming_web_search_node)
    graph.add_node("analyze", _streaming_analyze_node)
    graph.add_node("generate", _streaming_generate_node)

    graph.set_entry_point("resolve_query")
    graph.add_edge("resolve_query", "classify_intent")
    graph.add_conditional_edges(
        "classify_intent",
        _route_streaming_graph,
        {
            "answer_sources": "answer_sources",
            "answer_from_artifact": "answer_from_artifact",
            "answer_coding": "answer_coding",
            "answer_direct": "answer_direct",
            "answer_react": "answer_react",
            "web_search": "web_search",
        },
    )
    graph.add_conditional_edges(
        "web_search",
        _route_after_streaming_search,
        {
            "analyze": "analyze",
            "end": END,
        },
    )
    graph.add_conditional_edges(
        "analyze",
        _route_after_streaming_analysis,
        {
            "generate": "generate",
            "end": END,
        },
    )
    graph.add_edge("answer_sources", END)
    graph.add_edge("answer_from_artifact", END)
    graph.add_edge("answer_coding", END)
    graph.add_edge("answer_direct", END)
    graph.add_edge("answer_react", END)
    graph.add_edge("generate", END)

    return graph.compile()


def _get_streaming_research_graph() -> Any:
    if research_agent is not None:
        return research_agent
    return build_streaming_research_graph()


async def _classify_streaming_intent_node(state: dict[str, Any]) -> dict[str, Any]:
    tracer = get_langfuse_tracer()
    with tracer.start(
        "intent-routing",
        as_type="span",
        input={
            "query": state.get("display_query") or state.get("query"),
            "resolved_query": state.get("resolved_query"),
            "search_query": state.get("search_query"),
            "has_latest_result": bool(state.get("latest_result")),
        },
        metadata={"run_id": state.get("run_id")},
    ) as intent_observation:
        result = await classify_research_intent_node(state)
        routed_state = {**state, **result}
        route = route_research_intent(routed_state)
        graph_route = route
        if routed_state.get("execution_mode") == "react" and route in {"answer_direct", "web_search"}:
            graph_route = "answer_react"
        intent_observation.update(
            output={
                "intent": result.get("intent"),
                "route": route,
                "graph_route": graph_route,
                "reason": result.get("reason"),
            }
        )

    return {
        **result,
        "route": route,
        "graph_route": graph_route,
    }


def _route_streaming_graph(state: dict[str, Any]) -> str:
    graph_route = state.get("graph_route")
    if isinstance(graph_route, str) and graph_route:
        return graph_route
    route = state.get("route")
    if isinstance(route, str) and route:
        return route
    return route_research_intent(state)


def _route_after_streaming_search(state: dict[str, Any]) -> str:
    if state.get("web_search_completed") and state.get("documents"):
        return "analyze"
    return "end"


def _route_after_streaming_analysis(state: dict[str, Any]) -> str:
    if state.get("analysis_completed") and state.get("analysis"):
        return "generate"
    return "end"


async def _streaming_answer_coding_node(state: dict[str, Any]) -> dict[str, Any]:
    tracer = get_langfuse_tracer()
    with tracer.start(
        "coding-answer-llm",
        as_type="span",
        input={"query": state.get("display_query") or state.get("query")},
        metadata={"run_id": state.get("run_id")},
    ) as answer_observation:
        result = await _collect_streaming_node_events(stream_answer_coding_node(state))
        answer_observation.update(
            output={
                "answer_preview": _text_preview(result.get("answer")),
                "thinking_preview": _text_preview(result.get("report_thinking")),
            }
        )
        return result


async def _streaming_answer_direct_node(state: dict[str, Any]) -> dict[str, Any]:
    tracer = get_langfuse_tracer()
    with tracer.start(
        "direct-answer-llm",
        as_type="span",
        input={"query": state.get("display_query") or state.get("query")},
        metadata={"run_id": state.get("run_id")},
    ) as answer_observation:
        result = await _collect_streaming_node_events(stream_answer_direct_node(state))
        answer_observation.update(
            output={
                "answer_preview": _text_preview(result.get("answer")),
                "thinking_preview": _text_preview(result.get("report_thinking")),
            }
        )
        return result


async def _streaming_answer_sources_node(state: dict[str, Any]) -> dict[str, Any]:
    latest_result = state.get("latest_result") or {}
    tracer = get_langfuse_tracer()
    with tracer.start(
        "answer-sources",
        as_type="span",
        input={
            "query": state.get("display_query") or state.get("query"),
            "documents_count": len(latest_result.get("documents", [])),
        },
        metadata={"run_id": state.get("run_id")},
    ) as answer_observation:
        result = await answer_sources_node(state)
        answer_observation.update(
            output={
                "answer_preview": _text_preview(result.get("answer")),
                "documents": _documents_observability_items(result.get("documents", [])),
            }
        )
        return result


async def _streaming_answer_from_artifact_node(state: dict[str, Any]) -> dict[str, Any]:
    latest_result = state.get("latest_result") or {}
    tracer = get_langfuse_tracer()
    with tracer.start(
        "artifact-follow-up-llm",
        as_type="span",
        input={
            "query": state.get("display_query") or state.get("query"),
            "report_preview": _text_preview(latest_result.get("report")),
        },
        metadata={"run_id": state.get("run_id")},
    ) as answer_observation:
        result = await answer_from_artifact_node(state)
        answer_observation.update(
            output={
                "answer_preview": _text_preview(result.get("answer")),
                "thinking_preview": _text_preview(result.get("report_thinking")),
            }
        )
        return result


async def _streaming_analyze_node(state: dict[str, Any]) -> dict[str, Any]:
    tracer = get_langfuse_tracer()
    with tracer.start(
        "analyze-llm",
        as_type="span",
        input={
            "query": state.get("display_query") or state.get("query"),
            "contextual_query": state.get("query"),
            "documents_count": len(state.get("documents", [])),
            "documents": _documents_observability_items(state.get("documents", [])),
        },
        metadata={"run_id": state.get("run_id")},
    ) as analyze_observation:
        result = await _collect_streaming_node_events(stream_analyze_node(state))
        analyze_observation.update(
            output={
                "analysis_preview": _text_preview(result.get("analysis")),
                "thinking_preview": _text_preview(result.get("analysis_thinking")),
            }
        )
        return result


async def _streaming_generate_node(state: dict[str, Any]) -> dict[str, Any]:
    tracer = get_langfuse_tracer()
    with tracer.start(
        "report-llm",
        as_type="span",
        input={
            "query": state.get("display_query") or state.get("query"),
            "analysis_preview": _text_preview(state.get("analysis")),
            "documents_count": len(state.get("documents", [])),
        },
        metadata={"run_id": state.get("run_id")},
    ) as report_observation:
        result = await _collect_streaming_node_events(stream_generate_node(state))
        report_observation.update(
            output={
                "report_preview": _text_preview(result.get("report")),
                "thinking_preview": _text_preview(result.get("report_thinking")),
            }
        )
        return result


async def _collect_streaming_node_events(stream: Any) -> dict[str, Any]:
    events: list[dict[str, Any]] = []
    final_state: dict[str, Any] = {}

    async for event in stream:
        if not isinstance(event, dict):
            continue
        events.append(event)
        if event.get("type") == "final":
            final_state.update(event.get("state") or {})

    final_state["stream_events"] = events
    return final_state


async def _streaming_answer_react_node(state: dict[str, Any]) -> dict[str, Any]:
    events: list[dict[str, Any]] = []
    working_state = dict(state)

    tracer = get_langfuse_tracer()
    with tracer.start(
        "react-agent",
        as_type="agent",
        input={
            "query": _resolved_query(working_state),
            "display_query": state.get("display_query"),
            "route": state.get("route"),
        },
        metadata={"run_id": state.get("run_id")},
    ) as react_observation:
        async for react_event in stream_react_agent_messages(_resolved_query(working_state)):
            if not isinstance(react_event, dict):
                continue

            events.append(react_event)
            event_type = react_event.get("type")

            if event_type == "agent_message":
                message = react_event.get("message") if isinstance(react_event.get("message"), dict) else {}
                _merge_react_documents(working_state, message)
            elif event_type == "clarification":
                question = str(react_event.get("question") or react_event.get("message") or "").strip()
                working_state.update(
                    {
                        "answer": question,
                        "result_type": "answer",
                        "report_completed": True,
                    }
                )
                break
            elif event_type == "final":
                working_state.update(
                    {
                        "answer": str(react_event.get("answer") or "").strip(),
                        "result_type": "answer",
                        "report_completed": True,
                    }
                )
        react_observation.update(
            output={
                "answer_preview": _text_preview(working_state.get("answer")),
                "documents": _documents_observability_items(working_state.get("documents", [])),
            }
        )

    return {
        "documents": working_state.get("documents", []),
        "answer": working_state.get("answer"),
        "result_type": working_state.get("result_type") or "answer",
        "report_completed": bool(working_state.get("report_completed")),
        "stream_events": events,
    }


async def _streaming_web_search_node(state: dict[str, Any]) -> dict[str, Any]:
    tracer = get_langfuse_tracer()
    with tracer.start(
        "web-search",
        as_type="tool",
        input={
            "query": _search_query(state),
            "display_query": state.get("display_query") or state.get("query"),
            "contextual_query": state.get("query"),
            "provider": "duckduckgo",
        },
        metadata={"run_id": state.get("run_id")},
    ) as search_observation:
        result = await web_search_node(state)
        documents = result.get("documents", [])
        search_observation.update(
            output={
                "documents_count": len(documents),
                "documents": _documents_observability_items(documents),
            }
        )
    documents = result.get("documents", [])
    if documents:
        return result

    return {
        **result,
        "analysis": "No relevant documents found for the given query.",
        "report": f"# Research Report: {state.get('display_query') or state.get('query')}\n\nNo relevant documents found.",
        "analysis_completed": True,
        "report_completed": True,
    }


async def _stream_langgraph_research_events(
    state: dict[str, Any],
    *,
    visible_query: str,
    contextual_query: str,
    run_id: str | None,
    latest_result: dict[str, Any] | None,
    execution_mode: str,
    tracer: Any,
    record_event: Any,
    complete_event: Any,
) -> AsyncIterator[str]:
    state["execution_mode"] = execution_mode

    with tracer.start(
        "research-run",
        as_type="agent",
        input={
            "query": visible_query,
            "contextual_query": contextual_query,
        },
        metadata={
            "run_id": run_id,
            "has_latest_result": bool(latest_result),
            "runtime": "langgraph",
        },
    ) as run_observation, tracer.propagate_attributes(
        session_id=run_id,
        tags=["deep-research", "sse", "langgraph"],
    ):
        tracer.update_current_trace(
            name=f"research: {visible_query[:80]}",
            session_id=run_id,
            tags=["deep-research", "sse", "langgraph"],
            metadata={
                "run_id": run_id,
                "display_query": visible_query,
                "has_latest_result": bool(latest_result),
                "runtime": "langgraph",
            },
        )

        completed = False
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

            async for update in _get_streaming_research_graph().astream(state, stream_mode="updates"):
                if not isinstance(update, dict):
                    continue

                for node_name, node_update in update.items():
                    if not isinstance(node_update, dict):
                        continue

                    state.update(node_update)
                    async for event in _sse_events_for_graph_update(
                        node_name,
                        state,
                        visible_query=visible_query,
                        run_id=run_id,
                        record_event=record_event,
                        complete_event=complete_event,
                        run_observation=run_observation,
                    ):
                        yield event
                        if state.get("_stream_completed"):
                            completed = True

            if not completed:
                result_payload = _result_payload(state)
                run_observation.update(output=_result_observability_summary(result_payload))
                yield await complete_event(result_payload)
        except asyncio.CancelledError:
            run_observation.update(output={"status": "stopped"})
            raise
        except Exception as exc:
            run_observation.update(
                output={
                    "status": "failed",
                    "error": str(exc),
                }
            )
            yield record_event("stream_error", {"detail": f"Research execution failed: {exc}"})
        finally:
            tracer.flush()


async def _sse_events_for_graph_update(
    node_name: str,
    state: dict[str, Any],
    *,
    visible_query: str,
    run_id: str | None,
    record_event: Any,
    complete_event: Any,
    run_observation: Any,
) -> AsyncIterator[str]:
    if node_name == "classify_intent":
        route = _selected_route_for_trace(state)
        yield record_event(
            "trace",
            _trace_event(
                "route",
                "reasoning",
                "Route selected",
                _route_trace_detail(state, route),
                intent=state.get("intent"),
                route=route,
                graph_route=state.get("graph_route") or route,
                reason=state.get("reason"),
                resolved_query=state.get("resolved_query"),
                search_query=state.get("search_query"),
            ),
        )
        await asyncio.sleep(0)

        async for event in _pre_node_status_events(
            state.get("graph_route") or route,
            state,
            visible_query=visible_query,
            run_id=run_id,
            record_event=record_event,
        ):
            yield event
        return

    if node_name == "web_search":
        documents = state.get("documents", [])
        yield record_event("documents", {"documents": documents})
        await asyncio.sleep(0)
        search_tool_call_id = _search_tool_call_id(state, run_id)
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

        if not documents:
            async for event in _complete_stream_from_state(state, run_observation, complete_event):
                yield event
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
        return

    if node_name == "analyze":
        async for event in _emit_collected_stream_events(state.get("stream_events", []), record_event):
            yield event
        yield record_event("analysis", {"analysis": state.get("analysis")})
        await asyncio.sleep(0)

        if state.get("analysis_completed") and state.get("analysis"):
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
        return

    if node_name == "generate":
        async for event in _emit_collected_stream_events(state.get("stream_events", []), record_event):
            yield event
        yield record_event("report", {"report": state.get("report")})
        await asyncio.sleep(0)
        async for event in _complete_stream_from_state(state, run_observation, complete_event):
            yield event
        return

    if node_name in {"answer_coding", "answer_direct"}:
        async for event in _emit_collected_stream_events(state.get("stream_events", []), record_event):
            yield event
        yield record_event("answer", {"answer": state.get("answer")})
        await asyncio.sleep(0)
        async for event in _complete_stream_from_state(state, run_observation, complete_event):
            yield event
        return

    if node_name == "answer_react":
        async for event in _emit_react_stream_events(state, record_event):
            yield event
        if state.get("answer") is not None and not state.get("_react_answer_emitted"):
            yield record_event("answer", {"answer": state.get("answer")})
            await asyncio.sleep(0)
        async for event in _complete_stream_from_state(state, run_observation, complete_event):
            yield event
        return

    if node_name in {"answer_sources", "answer_from_artifact"}:
        if node_name == "answer_from_artifact" and state.get("report_thinking"):
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
        async for event in _complete_stream_from_state(state, run_observation, complete_event):
            yield event
        return


def _selected_route_for_trace(state: dict[str, Any]) -> str:
    route = state.get("route")
    if isinstance(route, str) and route:
        return route
    return route_research_intent(state)


async def _pre_node_status_events(
    graph_route: str,
    state: dict[str, Any],
    *,
    visible_query: str,
    run_id: str | None,
    record_event: Any,
) -> AsyncIterator[str]:
    if graph_route == "answer_coding":
        yield record_event(
            "status",
            {
                "stage": "coding",
                "label": "Solving",
                "message": "Writing a direct coding answer.",
            },
        )
        await asyncio.sleep(0)
        return

    if graph_route == "answer_direct":
        yield record_event(
            "status",
            {
                "stage": "answer",
                "label": "Answering",
                "message": "Answering directly without a research run.",
            },
        )
        await asyncio.sleep(0)
        return

    if graph_route == "answer_sources":
        yield record_event(
            "status",
            {
                "stage": "analyze",
                "label": "Answering",
                "message": "Reading sources from the previous research report.",
            },
        )
        await asyncio.sleep(0)
        return

    if graph_route == "answer_from_artifact":
        yield record_event(
            "status",
            {
                "stage": "analyze",
                "label": "Answering",
                "message": "Using the previous research report as context.",
            },
        )
        await asyncio.sleep(0)
        return

    if graph_route == "answer_react":
        yield record_event(
            "status",
            {
                "stage": "react",
                "label": "Reasoning",
                "message": "Running a ReAct agent with tools.",
            },
        )
        await asyncio.sleep(0)
        yield record_event(
            "trace",
            _trace_event(
                "react",
                "reasoning",
                "Run ReAct agent",
                "Starting a ReAct loop with model reasoning, tool calls, and observations.",
                route=state.get("route"),
                tool_policy="model-selected",
            ),
        )
        await asyncio.sleep(0)
        return

    if graph_route == "web_search":
        yield record_event(
            "status",
            {
                "stage": "search",
                "label": "Searching",
                "message": "Searching the web for useful sources and context.",
            },
        )
        await asyncio.sleep(0)
        search_tool_call_id = _search_tool_call_id(state, run_id)
        search_query = _search_query(state)
        yield record_event(
            "agent_message",
            _agent_ai_message(
                "search-reasoning",
                "Searching public web sources before answering.",
                [
                    {
                        "id": search_tool_call_id,
                        "name": "web_search",
                        "args": {"query": search_query},
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
                f"Searching public web sources for: {search_query}",
                query=search_query,
                display_query=visible_query,
                tool="web_search",
            ),
        )
        await asyncio.sleep(0)


async def _emit_collected_stream_events(
    events: list[dict[str, Any]],
    record_event: Any,
) -> AsyncIterator[str]:
    for event in events:
        if not isinstance(event, dict):
            continue

        event_type = event.get("type")
        if event_type == "answer_delta":
            yield record_event("answer_delta", {"delta": event.get("delta") or ""})
            await asyncio.sleep(0)
        elif event_type == "trace":
            yield record_event(
                "trace",
                _trace_event(
                    event.get("stage") or "coding",
                    event.get("kind") or "tool_call",
                    event.get("title") or "Sandbox tool",
                    event.get("detail") or "",
                    **{
                        key: value
                        for key, value in event.items()
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
        elif event_type in {"thinking", "draft"}:
            yield record_event("thinking", _thinking_payload(event))
            await asyncio.sleep(0)


async def _emit_react_stream_events(
    state: dict[str, Any],
    record_event: Any,
) -> AsyncIterator[str]:
    emitted_answer = False
    for react_event in state.get("stream_events", []):
        if not isinstance(react_event, dict):
            continue

        event_type = react_event.get("type")
        if event_type == "agent_message":
            message = react_event.get("message") if isinstance(react_event.get("message"), dict) else {}
            yield record_event("agent_message", message)
            for trace_event in _trace_events_from_agent_message(message):
                yield record_event("trace", trace_event)
            await asyncio.sleep(0)
        elif event_type == "clarification":
            if state.get("answer") is not None:
                yield record_event("answer", {"answer": state.get("answer")})
                emitted_answer = True
                await asyncio.sleep(0)

    if emitted_answer:
        state["_react_answer_emitted"] = True


async def _complete_stream_from_state(
    state: dict[str, Any],
    run_observation: Any,
    complete_event: Any,
) -> AsyncIterator[str]:
    if state.get("_stream_completed"):
        return

    result_payload = _result_payload(state)
    run_observation.update(output=_result_observability_summary(result_payload))
    state["_stream_completed"] = True
    yield await complete_event(result_payload)


def _search_tool_call_id(state: dict[str, Any], run_id: str | None) -> str:
    tool_call_id = state.get("_search_tool_call_id")
    if isinstance(tool_call_id, str) and tool_call_id:
        return tool_call_id

    tool_call_id = f"web-search-{run_id or 'live'}"
    state["_search_tool_call_id"] = tool_call_id
    return tool_call_id


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


def _resolved_query(state: dict[str, Any]) -> str:
    return str(state.get("resolved_query") or state.get("query") or state.get("display_query") or "").strip()


def _search_query(state: dict[str, Any]) -> str:
    return str(
        state.get("search_query")
        or state.get("resolved_query")
        or state.get("display_query")
        or state.get("query")
        or ""
    ).strip()


def _route_trace_detail(state: dict[str, Any], route: str) -> str:
    intent = str(state.get("intent") or "unknown")
    reason = str(state.get("reason") or "").strip()
    detail = f"Intent {intent} routed to {route}."
    if reason:
        return f"{detail} {reason}"
    return detail


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


def _trace_events_from_agent_message(message: dict[str, Any]) -> list[dict[str, Any]]:
    message_type = message.get("type")

    if message_type == "ai":
        return _trace_events_from_agent_ai_message(message)

    if message_type == "tool":
        trace_event = _trace_event_from_agent_tool_message(message)
        return [trace_event] if trace_event else []

    return []


def _trace_events_from_agent_ai_message(message: dict[str, Any]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    message_id = str(message.get("id") or "agent")
    reasoning = str(message.get("reasoning_content") or "").strip()

    if reasoning:
        events.append(
            _trace_event(
                "analyze",
                "reasoning",
                "Thinking",
                reasoning,
                id=f"{message_id}-reasoning",
            )
        )

    tool_calls = message.get("tool_calls")
    if not isinstance(tool_calls, list):
        return events

    for index, tool_call in enumerate(tool_calls):
        if not isinstance(tool_call, dict):
            continue

        tool_name = str(tool_call.get("name") or "")
        tool_args = tool_call.get("args") if isinstance(tool_call.get("args"), dict) else {}
        tool_call_id = str(tool_call.get("id") or f"{message_id}-tool-{index}")
        extra: dict[str, Any] = {
            "id": f"{tool_call_id}-call",
            "tool": tool_name,
        }
        if tool_name == "web_search" and isinstance(tool_args.get("query"), str):
            extra["query"] = tool_args["query"]

        events.append(
            _trace_event(
                _stage_for_agent_tool(tool_name),
                "tool_call",
                _title_for_agent_tool_call(tool_name),
                _detail_for_agent_tool_call(tool_name, tool_args),
                **extra,
            )
        )

    return events


def _trace_event_from_agent_tool_message(message: dict[str, Any]) -> dict[str, Any] | None:
    tool_name = str(message.get("name") or "")
    tool_call_id = str(message.get("tool_call_id") or message.get("id") or tool_name or "tool")
    content = str(message.get("content") or "")
    documents = _documents_for_agent_tool_result(tool_name, content)
    extra: dict[str, Any] = {
        "id": f"{tool_call_id}-result",
        "tool": tool_name,
    }
    if documents:
        extra["documents"] = documents

    return _trace_event(
        _stage_for_agent_tool(tool_name),
        "tool_result",
        _title_for_agent_tool_result(tool_name),
        _detail_for_agent_tool_result(tool_name, content, documents),
        **extra,
    )


def _stage_for_agent_tool(tool_name: str) -> str:
    if tool_name == "web_search":
        return "search"
    if tool_name == "ask_clarification":
        return "answer"
    if any(fragment in tool_name for fragment in ("file", "dir", "bash", "python")):
        return "coding"
    return "analyze"


def _title_for_agent_tool_call(tool_name: str) -> str:
    labels = {
        "web_search": "Search web",
        "ask_clarification": "Need your help",
        "read_file": "Read file",
        "list_dir": "List directory",
        "bash": "Execute command",
        "run_python": "Run Python",
        "write_todos": "Write to-dos",
    }
    return labels.get(tool_name, f"Use {tool_name}")


def _title_for_agent_tool_result(tool_name: str) -> str:
    if tool_name == "web_search":
        return "Sources found"
    if tool_name == "ask_clarification":
        return "Clarification requested"
    return "Tool result"


def _detail_for_agent_tool_call(tool_name: str, tool_args: dict[str, Any]) -> str:
    if tool_name == "web_search" and isinstance(tool_args.get("query"), str):
        return tool_args["query"]
    if tool_name == "ask_clarification" and isinstance(tool_args.get("question"), str):
        return tool_args["question"]
    return json.dumps(tool_args, ensure_ascii=False, separators=(",", ":"))


def _detail_for_agent_tool_result(
    tool_name: str,
    content: str,
    documents: list[dict[str, Any]],
) -> str:
    if tool_name == "web_search":
        count = len(documents)
        return f"Found {count} source candidate{'s' if count != 1 else ''}."
    return content


def _documents_for_agent_tool_result(tool_name: str, content: str) -> list[dict[str, Any]]:
    if tool_name != "web_search":
        return []

    try:
        payload = json.loads(content)
    except json.JSONDecodeError:
        return []

    if not isinstance(payload, list):
        return []

    documents: list[dict[str, Any]] = []
    for index, item in enumerate(payload):
        if not isinstance(item, dict):
            continue
        documents.append(
            {
                "id": item.get("id", f"agent-web-{index}"),
                "title": item.get("title") or f"Source {index + 1}",
                "url": item.get("url"),
                "source": item.get("source"),
                "provider": item.get("provider") or "react",
                "type": item.get("type"),
            }
        )

    return documents


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
