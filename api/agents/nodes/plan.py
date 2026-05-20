"""Plan node - Generate a query-specific research plan."""

from __future__ import annotations

import json
import re
from typing import Any

from langchain.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

from agents.nodes.reasoning import extract_response_parts
from core.config import get_settings
from services.langfuse_observability import ainvoke_langchain, get_langfuse_tracer

settings = get_settings()

JSON_BLOCK_PATTERN = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)


async def generate_research_plan(query: str) -> dict[str, Any]:
    """Generate a structured research plan tailored to the user's query."""
    normalized_query = query.strip()

    llm = ChatOpenAI(
        model=settings.llm_model,
        temperature=0.2,
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url,
    )

    prompt = _build_research_plan_prompt()

    chain = prompt | llm
    payload = {"query": normalized_query}
    config = _langchain_config("research-plan-llm", "plan")
    response = await ainvoke_langchain(chain, payload, config)
    content, _thinking = extract_response_parts(response)
    payload = _parse_json_payload(content)

    return _normalize_plan_payload(normalized_query, payload)


async def assess_research_plan_need(query: str) -> dict[str, Any]:
    """Ask the model whether this request needs a reviewable research plan."""
    normalized_query = query.strip()
    rule_result = _assess_plan_need_by_rules(normalized_query)
    if rule_result is not None:
        return rule_result

    llm = ChatOpenAI(
        model=settings.llm_model,
        temperature=0,
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url,
    )

    prompt = _build_plan_need_prompt()
    chain = prompt | llm
    payload = {"query": normalized_query}
    config = _langchain_config("plan-need-llm", "plan")
    response = await ainvoke_langchain(chain, payload, config)
    content, _thinking = extract_response_parts(response)
    payload = _parse_json_payload(content)

    return _normalize_plan_need_payload(payload)


def _assess_plan_need_by_rules(query: str) -> dict[str, Any] | None:
    normalized_query = query.lower()
    coding_terms = (
        "力扣",
        "leetcode",
        "代码",
        "写一段",
        "写个",
        "实现",
        "函数",
        "算法",
        "debug",
        "bug",
        "报错",
        "code",
        "program",
        "function",
        "implement",
    )

    if any(term in normalized_query for term in coding_terms):
        return {
            "should_plan": False,
            "reason": "This is a coding request and can be answered directly.",
        }

    return None


def _build_research_plan_prompt() -> ChatPromptTemplate:
    return ChatPromptTemplate.from_messages(
        [
            (
                "system",
                """You create concise deep research plans.

Return valid JSON only. Do not include markdown or commentary.
The JSON must match this shape:
{{
  "summary": "One sentence describing the tailored research route.",
  "steps": [
    {{"id": "short-lowercase-id", "title": "Step title", "detail": "Concrete task for this query"}}
  ]
}}

Rules:
- Create exactly 4 steps.
- Make every title and detail specific to the user's query.
- Include source discovery, evidence comparison, and final report synthesis.
- Keep each detail under 160 characters.""",
            ),
            (
                "user",
                "Create a research plan for this query:\n\n{query}",
            ),
        ]
    )


def _build_plan_need_prompt() -> ChatPromptTemplate:
    return ChatPromptTemplate.from_messages(
        [
            (
                "system",
                """Decide whether a user request needs a visible deep-research plan.

Return valid JSON only:
{{
  "should_plan": true,
  "reason": "brief reason"
}}

Use should_plan=true for:
- new broad research tasks
- multi-step tasks needing source discovery, comparison, and synthesis
- requests that likely require 3+ distinct research steps

Use should_plan=false for:
- simple follow-up questions
- source clarification, "where did this come from?", or narrow factual follow-ups
- purely conversational or informational requests
- tasks where the next action is obvious.""",
            ),
            ("user", "Request:\n\n{query}"),
        ]
    )


def _parse_json_payload(content: str) -> dict[str, Any]:
    text = content.strip()
    block_match = JSON_BLOCK_PATTERN.search(text)
    if block_match:
        text = block_match.group(1).strip()

    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError("Model returned an invalid research plan JSON payload") from exc

    if not isinstance(payload, dict):
        raise ValueError("Model research plan payload must be a JSON object")

    return payload


def _normalize_plan_payload(query: str, payload: dict[str, Any]) -> dict[str, Any]:
    raw_steps = payload.get("steps")
    if not isinstance(raw_steps, list) or len(raw_steps) != 4:
        raise ValueError("Model research plan payload must include exactly 4 steps")

    summary = str(payload.get("summary", "")).strip()
    if not summary:
        raise ValueError("Model research plan payload must include a summary")

    if _looks_like_generic_fallback_summary(summary):
        raise ValueError("Model research plan summary was generic; retry plan generation")

    steps = []
    for index, raw_step in enumerate(raw_steps, start=1):
        if not isinstance(raw_step, dict):
            raise ValueError("Each research plan step must be an object")

        title = str(raw_step.get("title", "")).strip()
        detail = str(raw_step.get("detail", "")).strip()
        if not title or not detail:
            raise ValueError("Each research plan step must include title and detail")

        step_id = str(raw_step.get("id", "")).strip() or f"step-{index}"
        steps.append(
            {
                "id": _slugify_step_id(step_id, index),
                "title": title,
                "detail": detail,
            }
        )

    return {
        "query": query,
        "source_label": "Public web",
        "summary": summary,
        "steps": steps,
        "should_plan": True,
    }


def _normalize_plan_need_payload(payload: dict[str, Any]) -> dict[str, Any]:
    raw_should_plan = payload.get("should_plan")
    if isinstance(raw_should_plan, str):
        should_plan = raw_should_plan.strip().lower() in {"true", "yes", "1"}
    else:
        should_plan = bool(raw_should_plan)

    return {
        "should_plan": should_plan,
        "reason": str(payload.get("reason", "")).strip(),
    }


def _slugify_step_id(value: str, index: int) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or f"step-{index}"


def _looks_like_generic_fallback_summary(summary: str) -> bool:
    normalized_summary = summary.strip().lower()
    return (
        "across public web sources" in normalized_summary
        and "compare evidence" in normalized_summary
        and "produce a cited report" in normalized_summary
    )


def _langchain_config(run_name: str, stage: str) -> dict[str, Any]:
    return get_langfuse_tracer().langchain_config(
        run_name,
        metadata={
            "feature": "research-plan",
            "stage": stage,
        },
    )
