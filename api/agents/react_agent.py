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
from agents.token_usage import extract_token_usage
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

_FINAL_SYNTHESIS_INSTRUCTION = (
    "You have reached the tool-use budget. Stop calling tools. Answer from the gathered evidence and clearly note "
    "any uncertainty or missing information."
)

_REPEATED_TOOL_CALL_WARNING = (
    "You are repeating the same tool call without adding new evidence. Stop searching and answer from the gathered "
    "evidence unless there is a clearly different tool call that would materially change the answer."
)


async def stream_react_agent_messages(
    query: str,
    *,
    model: Any | None = None,
    tool_runner: ToolRunner | None = None,
    skills: list[AgentSkill] | None = None,
    max_rounds: int = 4,
) -> AsyncIterator[dict[str, Any]]:
    """Stream a minimal ReAct exchange as serializable message events."""
    available_skills = load_enabled_skills() if skills is None else list(skills)
    loaded_skills: list[AgentSkill] = []
    loaded_skill_names: set[str] = set()
    runnable_model = model or _build_model(available_skills)
    runner = tool_runner or _run_builtin_tool
    messages: list[Any] = [
        SystemMessage(content=build_react_system_prompt(loaded_skills, available_skills=available_skills)),
        HumanMessage(content=query),
    ]
    previous_tool_call_signature: tuple[tuple[str, str], ...] | None = None
    repeated_tool_call_count = 0

    for _round in range(max_rounds):
        messages[0] = SystemMessage(
            content=build_react_system_prompt(
                loaded_skills,
                available_skills=_unloaded_skills(available_skills, loaded_skill_names),
            )
        )
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

            if tool_name == "load_skill":
                skill = _find_skill(available_skills, tool_args)
                already_loaded = bool(skill and skill.name in loaded_skill_names)
                if skill and not already_loaded:
                    loaded_skills.append(skill)
                    loaded_skill_names.add(skill.name)
                content = _load_skill_tool_content(tool_args, skill, already_loaded=already_loaded)
                messages.append(ToolMessage(content=content, tool_call_id=tool_call_id, name=tool_name))
                yield _skill_loaded_trace_event(tool_args, skill, already_loaded=already_loaded)
                continue

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

        tool_call_signature = _tool_call_signature(tool_calls)
        if tool_call_signature == previous_tool_call_signature:
            repeated_tool_call_count += 1
        else:
            previous_tool_call_signature = tool_call_signature
            repeated_tool_call_count = 1

        if repeated_tool_call_count == 2:
            messages.append(HumanMessage(content=_REPEATED_TOOL_CALL_WARNING))

    messages.append(HumanMessage(content=_FINAL_SYNTHESIS_INSTRUCTION))
    synthesis_model = _model_without_tools(runnable_model)
    response = await synthesis_model.ainvoke(
        messages,
        _langchain_config("react-agent-final-synthesis", "final_synthesis"),
    )
    messages.append(response)

    ai_message = _serialize_ai_message(response)
    answer = str(ai_message.get("content") or "").strip()
    if ai_message.get("tool_calls"):
        ai_message = {**ai_message, "tool_calls": []}
    if answer or str(ai_message.get("reasoning_content") or "").strip():
        yield {"type": "agent_message", "message": ai_message}

    if answer:
        yield {"type": "final", "answer": answer}
        return

    yield {"type": "final", "answer": _partial_answer_fallback(messages)}


def build_react_system_prompt(
    skills: list[AgentSkill] | None = None,
    *,
    available_skills: list[AgentSkill] | None = None,
) -> str:
    blocks = [REACT_SYSTEM_PROMPT.rstrip()]
    catalog_prompt = _format_skill_catalog_for_prompt(available_skills or [])
    if catalog_prompt:
        blocks.append(catalog_prompt)
    skill_prompt = format_skills_for_prompt(skills or [])
    if skill_prompt:
        blocks.append(skill_prompt)
    return "\n\n".join(blocks) + "\n"


def _format_skill_catalog_for_prompt(skills: list[AgentSkill]) -> str:
    if not skills:
        return ""

    lines = [
        "Available skills are listed below. Do not assume they are already active.",
        "When a skill materially applies, call load_skill with the exact name before using its workflow.",
        "Load only the skills needed for the current request.",
    ]
    for skill in skills:
        description = skill.description.strip() or "No description."
        lines.append(f"- {skill.name}: {description}")
    return "\n".join(lines)


def _unloaded_skills(skills: list[AgentSkill], loaded_skill_names: set[str]) -> list[AgentSkill]:
    return [skill for skill in skills if skill.name not in loaded_skill_names]


def _find_skill(skills: list[AgentSkill], args: dict[str, Any]) -> AgentSkill | None:
    requested_name = str(args.get("name") or args.get("skill_name") or "").strip()
    if not requested_name:
        return None
    for skill in skills:
        if skill.name == requested_name:
            return skill
    return None


def _load_skill_tool_content(
    args: dict[str, Any],
    skill: AgentSkill | None,
    *,
    already_loaded: bool,
) -> str:
    requested_name = str(args.get("name") or args.get("skill_name") or "").strip() or "(missing)"
    if skill is None:
        return f"Skill not found: {requested_name}. Use one of the available skill names exactly."
    if already_loaded:
        return f"Skill already loaded: {skill.name}."
    return f"Loaded skill: {skill.name}."


def _skill_loaded_trace_event(
    args: dict[str, Any],
    skill: AgentSkill | None,
    *,
    already_loaded: bool,
) -> dict[str, Any]:
    requested_name = str(args.get("name") or args.get("skill_name") or "").strip() or "(missing)"
    if skill is None:
        return {
            "type": "trace",
            "stage": "react",
            "kind": "skill",
            "title": "Skill not found",
            "detail": f"Skill not found: {requested_name}",
            "skills": [],
        }

    return {
        "type": "trace",
        "stage": "react",
        "kind": "skill",
        "title": "Skill already loaded" if already_loaded else "Skill loaded",
        "detail": f"Skill already loaded: {skill.name}" if already_loaded else f"Loaded skill: {skill.name}",
        "skills": [_skill_trace_item(skill)],
    }


def _skill_trace_item(skill: AgentSkill) -> dict[str, Any]:
    item: dict[str, Any] = {
        "name": skill.name,
        "description": skill.description,
    }
    if skill.path:
        item["path"] = str(skill.path)
    return item


def _build_model(skills: list[AgentSkill] | None = None) -> Any:
    llm = ChatOpenAI(
        model=settings.llm_model,
        temperature=0.2,
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url,
        extra_body={"reasoning_split": True},
        stream_usage=True,
    )
    return llm.bind_tools(available_react_tools_for_skills(skills or []))


def _model_without_tools(model: Any) -> Any:
    bind_tools = getattr(model, "bind_tools", None)
    if not callable(bind_tools):
        return model

    try:
        return bind_tools([], tool_choice="none")
    except TypeError:
        try:
            return bind_tools([])
        except Exception:
            return model
    except Exception:
        return model


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


@tool("load_skill", parse_docstring=True)
def load_skill_tool(name: str) -> str:
    """Load one available skill by exact name before applying its workflow.

    Args:
        name: Exact skill name from the available skill catalog.
    """
    return f"Requesting skill load: {name}"


def available_react_tools_for_skills(skills: list[AgentSkill] | None = None) -> list[Any]:
    available_skills = skills or []
    base_tools = filter_tools_by_skill_allowed_tools([web_search_tool, ask_clarification_tool], available_skills)
    if not available_skills:
        return base_tools
    return [load_skill_tool, *base_tools]


async def _run_builtin_tool(name: str, args: dict[str, Any]) -> Any:
    if name != "web_search":
        raise ValueError(f"Unsupported ReAct tool: {name}")

    query = str(args.get("query") or "").strip()
    result = await web_search_node({"query": query, "display_query": query})
    return _document_result_items(result.get("documents", []))


def _serialize_ai_message(message: Any) -> dict[str, Any]:
    content, reasoning = extract_response_parts(message)
    explicit_reasoning = _reasoning_from_additional_kwargs(getattr(message, "additional_kwargs", None))
    payload = {
        "type": "ai",
        "id": getattr(message, "id", None),
        "content": content,
        "reasoning_content": explicit_reasoning or reasoning or "",
        "tool_calls": [_serialize_tool_call(tool_call) for tool_call in list(getattr(message, "tool_calls", None) or [])],
    }
    token_usage = extract_token_usage(message)
    if token_usage:
        payload["usage_metadata"] = token_usage
    return payload


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


def _tool_call_signature(tool_calls: list[dict[str, Any]]) -> tuple[tuple[str, str], ...]:
    signature = []
    for tool_call in tool_calls:
        name = str(tool_call.get("name") or "")
        args = tool_call.get("args") if isinstance(tool_call.get("args"), dict) else {}
        signature.append((name, json.dumps(args, sort_keys=True, ensure_ascii=False)))
    return tuple(signature)


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


def _partial_answer_fallback(messages: list[Any]) -> str:
    observations = [
        str(getattr(message, "content", "") or "").strip()
        for message in messages
        if isinstance(message, ToolMessage) and str(getattr(message, "content", "") or "").strip()
    ]
    if not observations:
        return "I could not fully complete the request, and I do not have enough gathered evidence to answer reliably."

    summary = "\n".join(f"- {observation}" for observation in observations[-3:])
    return (
        "I could not fully complete the request, but here is a partial answer based on the information gathered:\n\n"
        f"{summary}"
    )


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
