"""Minimal ReAct agent loop.

This module keeps the loop small and explicit:
model reasoning/tool_calls -> local tool execution -> ToolMessage observation -> model again.
"""

from __future__ import annotations

import inspect
import json
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI

from agents.nodes.reasoning import extract_response_parts
from agents.nodes.web_search import web_search_node
from agents.skills import (
    AgentSkill,
    filter_tools_by_skill_allowed_tools,
    format_skills_for_prompt,
    load_enabled_skills,
)
from core.config import get_settings
from services.langfuse_observability import get_langfuse_tracer

settings = get_settings()

ToolRunner = Callable[[str, dict[str, Any]], Awaitable[Any] | Any]

REACT_SYSTEM_PROMPT = """You are a ReAct research assistant.

Use tools when they materially improve the answer:
- Use web_search for public web evidence or current facts.
- Use ask_clarification when the request is ambiguous enough that searching may target the wrong thing.

When you have enough information, answer directly. Keep answers concise and cite uncertainty.
"""


async def stream_react_agent_messages(
    query: str,
    *,
    model: Any | None = None,
    tool_runner: ToolRunner | None = None,
    skills: list[AgentSkill] | None = None,
    max_rounds: int = 4,
) -> AsyncIterator[dict[str, Any]]:
    """Stream a minimal ReAct exchange as serializable message events."""
    active_skills = load_enabled_skills() if skills is None else list(skills)
    runnable_model = model or _build_model(active_skills)
    runner = tool_runner or _run_builtin_tool
    messages: list[Any] = [
        SystemMessage(content=build_react_system_prompt(active_skills)),
        HumanMessage(content=query),
    ]

    for _round in range(max_rounds):
        response = await runnable_model.ainvoke(
            messages,
            _langchain_config("react-agent-llm", "react"),
        )
        messages.append(response)

        ai_message = _serialize_ai_message(response)
        yield {"type": "agent_message", "message": ai_message}

        tool_calls = ai_message.get("tool_calls") or []
        if not tool_calls:
            answer = str(ai_message.get("content") or "").strip()
            yield {"type": "final", "answer": answer}
            return

        for tool_call in tool_calls:
            tool_name = str(tool_call.get("name") or "")
            tool_args = tool_call.get("args") if isinstance(tool_call.get("args"), dict) else {}
            tool_call_id = str(tool_call.get("id") or tool_name)

            if tool_name == "ask_clarification":
                content = _format_clarification(tool_args)
                tool_message = _tool_message_payload(tool_call_id, tool_name, content)
                messages.append(ToolMessage(content=content, tool_call_id=tool_call_id, name=tool_name))
                yield {"type": "agent_message", "message": tool_message}
                yield {
                    "type": "clarification",
                    "question": str(tool_args.get("question") or "").strip(),
                    "options": _normalize_options(tool_args.get("options")),
                    "message": content,
                }
                return

            result = runner(tool_name, tool_args)
            if inspect.isawaitable(result):
                result = await result

            content = _tool_result_content(result)
            messages.append(ToolMessage(content=content, tool_call_id=tool_call_id, name=tool_name))
            yield {
                "type": "agent_message",
                "message": _tool_message_payload(tool_call_id, tool_name, content),
            }

    answer = "I reached the maximum number of ReAct tool rounds before producing a final answer."
    yield {"type": "final", "answer": answer}


def build_react_system_prompt(skills: list[AgentSkill] | None = None) -> str:
    skill_prompt = format_skills_for_prompt(skills or [])
    if not skill_prompt:
        return REACT_SYSTEM_PROMPT
    return f"{REACT_SYSTEM_PROMPT.rstrip()}\n\n{skill_prompt}\n"


def _build_model(skills: list[AgentSkill] | None = None) -> Any:
    llm = ChatOpenAI(
        model=settings.llm_model,
        temperature=0.2,
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url,
        extra_body={"reasoning_split": True},
    )
    return llm.bind_tools(available_react_tools_for_skills(skills or []))


@tool("web_search", parse_docstring=True)
async def web_search_tool(query: str) -> str:
    """Search the public web for relevant sources.

    Args:
        query: Search query.
    """
    result = await _run_builtin_tool("web_search", {"query": query})
    return _tool_result_content(result)


@tool("ask_clarification", parse_docstring=True)
def ask_clarification_tool(question: str, options: list[str] | None = None) -> str:
    """Ask the user to clarify an ambiguous request.

    Args:
        question: The clarification question to ask.
        options: Optional short choices for the user.
    """
    return _format_clarification({"question": question, "options": options or []})


def available_react_tools_for_skills(skills: list[AgentSkill] | None = None) -> list[Any]:
    return filter_tools_by_skill_allowed_tools([web_search_tool, ask_clarification_tool], skills or [])


async def _run_builtin_tool(name: str, args: dict[str, Any]) -> Any:
    if name != "web_search":
        raise ValueError(f"Unsupported ReAct tool: {name}")

    query = str(args.get("query") or "").strip()
    result = await web_search_node({"query": query, "display_query": query})
    return _document_result_items(result.get("documents", []))


def _serialize_ai_message(message: Any) -> dict[str, Any]:
    content, reasoning = extract_response_parts(message)
    explicit_reasoning = _reasoning_from_additional_kwargs(getattr(message, "additional_kwargs", None))
    return {
        "type": "ai",
        "id": getattr(message, "id", None),
        "content": content,
        "reasoning_content": explicit_reasoning or reasoning or "",
        "tool_calls": [_serialize_tool_call(tool_call) for tool_call in list(getattr(message, "tool_calls", None) or [])],
    }


def _reasoning_from_additional_kwargs(additional_kwargs: Any) -> str:
    if not isinstance(additional_kwargs, dict):
        return ""
    value = additional_kwargs.get("reasoning_content")
    if value is None:
        value = additional_kwargs.get("reasoning")
    return str(value or "").strip()


def _serialize_tool_call(tool_call: Any) -> dict[str, Any]:
    if isinstance(tool_call, dict):
        return {
            "id": tool_call.get("id"),
            "name": tool_call.get("name"),
            "args": tool_call.get("args") if isinstance(tool_call.get("args"), dict) else {},
        }

    return {
        "id": getattr(tool_call, "id", None),
        "name": getattr(tool_call, "name", None),
        "args": getattr(tool_call, "args", {}) if isinstance(getattr(tool_call, "args", {}), dict) else {},
    }


def _tool_message_payload(tool_call_id: str, name: str, content: str) -> dict[str, Any]:
    return {
        "type": "tool",
        "id": f"tool-{tool_call_id}",
        "tool_call_id": tool_call_id,
        "name": name,
        "content": content,
    }


def _tool_result_content(result: Any) -> str:
    if isinstance(result, str):
        return result
    return json.dumps(result, ensure_ascii=False)


def _format_clarification(args: dict[str, Any]) -> str:
    question = str(args.get("question") or "").strip()
    options = _normalize_options(args.get("options"))
    if not options:
        return question
    option_lines = [f"{index}. {option}" for index, option in enumerate(options, start=1)]
    return "\n\n".join([question, "\n".join(option_lines)])


def _normalize_options(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return [value]
        return _normalize_options(parsed)
    if not isinstance(value, list):
        return [str(value)]
    return [str(item) for item in value if str(item).strip()]


def _document_result_items(documents: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items = []
    for document in documents:
        metadata = document.get("metadata") if isinstance(document, dict) else {}
        metadata = metadata if isinstance(metadata, dict) else {}
        items.append(
            {
                "title": metadata.get("title") or str(document.get("content") or "").splitlines()[0],
                "url": metadata.get("url"),
                "source": metadata.get("source"),
            }
        )
    return items


def _langchain_config(run_name: str, stage: str) -> dict[str, Any]:
    return get_langfuse_tracer().langchain_config(
        run_name,
        metadata={
            "feature": "react-agent",
            "stage": stage,
        },
    )
