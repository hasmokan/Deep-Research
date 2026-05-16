"""Plan node - Generate a query-specific research plan."""

from __future__ import annotations

import json
import re
from typing import Any

from langchain.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

from agents.nodes.reasoning import extract_response_parts
from core.config import get_settings

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
    response = await chain.ainvoke({"query": normalized_query})
    content, _thinking = extract_response_parts(response)
    payload = _parse_json_payload(content)

    return _normalize_plan_payload(normalized_query, payload)


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
    if not isinstance(raw_steps, list) or not raw_steps:
        raise ValueError("Model research plan payload must include steps")

    steps = []
    for index, raw_step in enumerate(raw_steps[:4], start=1):
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

    summary = str(payload.get("summary", "")).strip()
    if not summary:
        summary = f'Research "{query}" across public web sources, compare evidence, and produce a cited report.'

    return {
        "query": query,
        "source_label": "Public web",
        "summary": summary,
        "steps": steps,
    }


def _slugify_step_id(value: str, index: int) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or f"step-{index}"
