"""Conversation-aware routing nodes for follow-up research requests."""

from __future__ import annotations

import re
import json
from typing import Any, Literal

from langchain.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
from core.config import get_settings
from agents.nodes.reasoning import extract_response_parts


settings = get_settings()
INTENTS = {"source_question", "artifact_follow_up", "new_research"}
JSON_BLOCK_PATTERN = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)

SOURCE_TERMS = (
    "来源",
    "出处",
    "引用",
    "参考",
    "文献",
    "文档",
    "资料",
    "材料",
    "数据来源",
    "第一条",
    "第一篇",
    "第一份",
    "第一个",
    "链接",
    "source",
    "sources",
    "citation",
    "citations",
    "reference",
    "references",
    "document",
    "documents",
    "doc",
    "docs",
    "url",
    "link",
)

ARTIFACT_FOLLOW_UP_TERMS = (
    "总结",
    "概括",
    "摘要",
    "改写",
    "重写",
    "润色",
    "扩写",
    "展开",
    "精简",
    "翻译",
    "表格",
    "列表",
    "summarize",
    "summary",
    "rewrite",
    "expand",
    "elaborate",
    "shorten",
    "translate",
    "table",
    "bullet",
)


async def classify_research_intent_node(state: dict[str, Any]) -> dict[str, Any]:
    """Classify whether a user turn can be answered from the latest artifact."""
    query = _normalized_query(state)
    latest_result = state.get("latest_result")

    if not latest_result:
        return {"intent": "new_research"}

    try:
        return await _classify_follow_up_intent_with_llm(query, latest_result)
    except Exception:
        return _classify_follow_up_intent_by_rules(query, latest_result)


async def _classify_follow_up_intent_with_llm(
    query: str,
    latest_result: dict[str, Any],
) -> dict[str, str]:
    llm = ChatOpenAI(
        model=settings.llm_model,
        temperature=0,
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url,
    )
    prompt = _build_follow_up_intent_prompt()
    response = await (prompt | llm).ainvoke({
        "query": query,
        "artifact": _artifact_routing_context(latest_result),
    })
    content, _thinking = extract_response_parts(response)
    payload = _parse_intent_payload(content)

    return {
        "intent": payload["intent"],
        "reason": payload.get("reason", ""),
    }


def _classify_follow_up_intent_by_rules(query: str, latest_result: dict[str, Any]) -> dict[str, str]:
    if _contains_any(query, SOURCE_TERMS):
        return {"intent": "source_question"}

    if _contains_any(query, ARTIFACT_FOLLOW_UP_TERMS) and latest_result.get("report"):
        return {"intent": "artifact_follow_up"}

    return {"intent": "new_research"}


def _build_follow_up_intent_prompt() -> ChatPromptTemplate:
    return ChatPromptTemplate.from_messages([
        (
            "system",
            """You route one user turn in a research conversation.

Return valid JSON only:
{{
  "intent": "source_question | artifact_follow_up | new_research",
  "reason": "brief reason"
}}

Choose source_question when the user asks about sources, citations, documents, links, data provenance, or which returned document they mean.
Choose artifact_follow_up when the user asks to summarize, explain, rewrite, translate, reformat, expand, or clarify using the previous report/artifact.
Choose new_research when answering requires a fresh web search, a new topic, updated facts, or new evidence beyond the previous artifact.

Prefer using the previous artifact when the question can reasonably be answered from it.""",
        ),
        (
            "user",
            """Current user turn:
{query}

Previous research artifact:
{artifact}""",
        ),
    ])


def _artifact_routing_context(latest_result: dict[str, Any]) -> str:
    documents = _document_list(latest_result)
    document_lines = []

    for index, document in enumerate(documents[:8], start=1):
        metadata = document.get("metadata") if isinstance(document, dict) else {}
        metadata = metadata if isinstance(metadata, dict) else {}
        title = _document_title(document, metadata, index)
        url = str(metadata.get("url") or metadata.get("link") or "").strip()
        document_lines.append(f"{index}. {title}" + (f" - {url}" if url else ""))

    report = str(latest_result.get("report") or latest_result.get("analysis") or "").strip()
    if len(report) > 4000:
        report = f"...{report[-4000:]}"

    return "\n".join([
        f"Original query: {latest_result.get('query') or ''}",
        "Documents:",
        "\n".join(document_lines) if document_lines else "(none)",
        "Report excerpt:",
        report or "(none)",
    ])


def _parse_intent_payload(content: str) -> dict[str, str]:
    text = content.strip()
    block_match = JSON_BLOCK_PATTERN.search(text)
    if block_match:
        text = block_match.group(1).strip()

    payload = json.loads(text)
    if not isinstance(payload, dict):
        raise ValueError("Intent payload must be a JSON object")

    intent = str(payload.get("intent", "")).strip()
    if intent not in INTENTS:
        raise ValueError(f"Unsupported follow-up intent: {intent}")

    return {
        "intent": intent,
        "reason": str(payload.get("reason", "")).strip(),
    }


def route_research_intent(
    state: dict[str, Any],
) -> Literal["answer_sources", "answer_from_artifact", "web_search"]:
    """Map the classified intent to the next LangGraph node."""
    intent = state.get("intent")

    if intent == "source_question":
        return "answer_sources"
    if intent == "artifact_follow_up":
        return "answer_from_artifact"
    return "web_search"


async def answer_sources_node(state: dict[str, Any]) -> dict[str, Any]:
    """Answer citation/source questions from the latest research documents."""
    latest_result = state.get("latest_result") or {}
    documents = _document_list(latest_result)
    answer = _format_source_answer(documents, _normalized_query(state))

    return {
        "documents": documents,
        "analysis": None,
        "analysis_thinking": None,
        "report": None,
        "report_thinking": None,
        "answer": answer,
        "result_type": "answer",
        "report_completed": True,
    }


async def answer_from_artifact_node(state: dict[str, Any]) -> dict[str, Any]:
    """Answer lightweight report follow-ups from the latest generated report."""
    latest_result = state.get("latest_result") or {}
    report = latest_result.get("report") or latest_result.get("analysis")
    visible_query = state.get("display_query") or state.get("query") or "这个问题"
    thinking = None

    if not report:
        answer = "上一份研究结果里没有可复用的报告内容，需要重新做一次研究。"
        result_type = "answer"
    else:
        llm = ChatOpenAI(
            model=settings.llm_model,
            temperature=0.2,
            api_key=settings.openai_api_key,
            base_url=settings.openai_base_url,
            extra_body={"reasoning_split": True},
        )
        prompt = ChatPromptTemplate.from_messages([
            ("system", """You answer follow-up questions using only the previous research report.

Rules:
- Do not start a new web search.
- If the follow-up asks to summarize, rewrite, expand, translate, or reformat, transform the prior report accordingly.
- Preserve important caveats and source-sensitive claims.
- Match the user's language."""),
            ("user", """Follow-up request:
{query}

Previous research report:
{report}

Answer the follow-up directly."""),
        ])
        response = await (prompt | llm).ainvoke({
            "query": visible_query,
            "report": report,
        })
        answer, thinking = extract_response_parts(response)
        result_type = "answer"

    return {
        "documents": _document_list(latest_result),
        "analysis": None,
        "analysis_thinking": None,
        "report": None,
        "report_thinking": thinking,
        "answer": answer,
        "result_type": result_type,
        "report_completed": True,
    }


def _normalized_query(state: dict[str, Any]) -> str:
    query = state.get("display_query") or state.get("query") or ""
    return str(query).strip().lower()


def _contains_any(query: str, terms: tuple[str, ...]) -> bool:
    return any(term in query for term in terms)


def _document_list(latest_result: dict[str, Any]) -> list[dict[str, Any]]:
    documents = latest_result.get("documents")
    return documents if isinstance(documents, list) else []


def _format_source_answer(documents: list[dict[str, Any]], query: str = "") -> str:
    if not documents:
        return "上一份研究结果没有返回可引用的来源文档。"

    requested_index = _requested_document_index(query, len(documents))
    if requested_index is not None:
        return "你问的文档是：\n" + _format_source_line(
            requested_index,
            documents[requested_index - 1],
        )

    lines = ["上一份报告使用了这些来源："]

    for index, document in enumerate(documents, start=1):
        lines.append(_format_source_line(index, document))

    return "\n".join(lines)


def _requested_document_index(query: str, document_count: int) -> int | None:
    if document_count < 1:
        return None

    if any(term in query for term in ("第一条", "第一篇", "第一份", "第一个", "first")):
        return 1

    match = re.search(r"(?:第|#)?\s*(\d{1,2})\s*(?:条|篇|份|个|号|st|nd|rd|th)?", query)
    if not match:
        return None

    index = int(match.group(1))
    if 1 <= index <= document_count:
        return index

    return None


def _format_source_line(index: int, document: dict[str, Any]) -> str:
    metadata = document.get("metadata") if isinstance(document, dict) else {}
    metadata = metadata if isinstance(metadata, dict) else {}
    title = _document_title(document, metadata, index)
    url = str(metadata.get("url") or metadata.get("link") or "").strip()
    source = str(metadata.get("source") or metadata.get("type") or "").strip()
    suffix = f"（{source}）" if source else ""

    if url:
        return f"{index}. [{title}]({url}){suffix}"

    return f"{index}. {title}{suffix}"


def _document_title(document: dict[str, Any], metadata: dict[str, Any], index: int) -> str:
    title = str(metadata.get("title") or "").strip()
    if title:
        return title

    content = str(document.get("content") or "").strip()
    match = re.match(r"^\*\*(.+?)\*\*", content)
    if match:
        return match.group(1).strip()

    first_line = content.splitlines()[0].strip() if content else ""
    return first_line[:80] if first_line else f"Source {index}"
