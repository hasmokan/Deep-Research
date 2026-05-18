"""Conversation-aware routing nodes for follow-up research requests."""

from __future__ import annotations

import re
import json
from typing import Any, Literal

from langchain.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
from core.config import get_settings
from agents.nodes.reasoning import extract_response_delta_parts, extract_response_parts
from services.langfuse_observability import ainvoke_langchain, astream_langchain, get_langfuse_tracer


settings = get_settings()
INTENTS = {"source_question", "artifact_follow_up", "coding_help", "direct_answer", "new_research"}
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

CODING_TERMS = (
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

DIRECT_ANSWER_TERMS = (
    "解释",
    "说明",
    "怎么理解",
    "什么意思",
    "什么是",
    "区别",
    "原理",
    "explain",
    "what is",
    "how does",
)


async def classify_research_intent_node(state: dict[str, Any]) -> dict[str, Any]:
    """Classify whether a user turn can be answered from the latest artifact."""
    query = _normalized_query(state)
    latest_result = state.get("latest_result")

    if not latest_result:
        return _classify_new_turn_intent_by_rules(query)

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
    chain = prompt | llm
    payload = {
        "query": query,
        "artifact": _artifact_routing_context(latest_result),
    }
    config = _langchain_config("intent-router-llm", "intent-routing")
    response = await ainvoke_langchain(chain, payload, config)
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


def _classify_new_turn_intent_by_rules(query: str) -> dict[str, str]:
    if _contains_any(query, CODING_TERMS):
        return {"intent": "coding_help", "reason": "The request asks for code or programming help."}

    if _is_likely_direct_answer(query):
        return {"intent": "direct_answer", "reason": "The request can be answered without source discovery."}

    return {"intent": "new_research", "reason": "The request may need fresh source discovery."}


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
) -> Literal["answer_sources", "answer_from_artifact", "answer_coding", "answer_direct", "web_search"]:
    """Map the classified intent to the next LangGraph node."""
    intent = state.get("intent")

    if intent == "source_question":
        return "answer_sources"
    if intent == "artifact_follow_up":
        return "answer_from_artifact"
    if intent == "coding_help":
        return "answer_coding"
    if intent == "direct_answer":
        return "answer_direct"
    return "web_search"


async def answer_coding_node(state: dict[str, Any]) -> dict[str, Any]:
    """Answer coding and algorithm requests directly without web research."""
    answer, thinking = await _answer_directly_with_llm(
        state,
        system_prompt=_CODING_ANSWER_PROMPT,
        temperature=0.2,
    )
    return _answer_state(answer, thinking)


async def answer_direct_node(state: dict[str, Any]) -> dict[str, Any]:
    """Answer simple informational requests directly without forcing a report."""
    answer, thinking = await _answer_directly_with_llm(
        state,
        system_prompt=_DIRECT_ANSWER_PROMPT,
        temperature=0.2,
    )
    return _answer_state(answer, thinking)


async def stream_answer_coding_node(state: dict[str, Any]):
    """Stream coding answer deltas and yield final answer state."""
    async for event in _stream_direct_answer_with_llm(
        state,
        system_prompt=_CODING_ANSWER_PROMPT,
        temperature=0.2,
        stage="coding",
        thinking_id="coding-thinking",
        thinking_label="Solution thinking",
    ):
        yield event


async def stream_answer_direct_node(state: dict[str, Any]):
    """Stream direct answer deltas and yield final answer state."""
    async for event in _stream_direct_answer_with_llm(
        state,
        system_prompt=_DIRECT_ANSWER_PROMPT,
        temperature=0.2,
        stage="answer",
        thinking_id="direct-answer-thinking",
        thinking_label="Answer thinking",
    ):
        yield event


async def _answer_directly_with_llm(
    state: dict[str, Any],
    *,
    system_prompt: str,
    temperature: float,
) -> tuple[str, str | None]:
    llm = ChatOpenAI(
        model=settings.llm_model,
        temperature=temperature,
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url,
        extra_body={"reasoning_split": True},
    )
    prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        ("user", "{query}"),
    ])
    chain = prompt | llm
    response = await ainvoke_langchain(
        chain,
        {"query": state.get("display_query") or state.get("query") or ""},
        _langchain_config("direct-answer-llm", "answer"),
    )
    answer, thinking = extract_response_parts(response)
    return answer.strip(), thinking


async def _stream_direct_answer_with_llm(
    state: dict[str, Any],
    *,
    system_prompt: str,
    temperature: float,
    stage: str,
    thinking_id: str,
    thinking_label: str,
):
    llm = ChatOpenAI(
        model=settings.llm_model,
        temperature=temperature,
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url,
        extra_body={"reasoning_split": True},
    )
    prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        ("user", "{query}"),
    ])
    chain = prompt | llm
    content_parts: list[str] = []
    thinking_parts: list[str] = []

    stream = astream_langchain(
        chain,
        {"query": state.get("display_query") or state.get("query") or ""},
        _langchain_config("direct-answer-llm", "answer"),
    )
    async for chunk in stream:
        content_delta, thinking_delta = extract_response_delta_parts(chunk)

        if thinking_delta:
            thinking_parts.append(thinking_delta)
            yield {
                "type": "thinking",
                "id": thinking_id,
                "stage": stage,
                "label": thinking_label,
                "text": "".join(thinking_parts).strip(),
            }

        if content_delta:
            content_parts.append(content_delta)
            yield {
                "type": "answer_delta",
                "delta": content_delta,
            }

    answer, embedded_thinking = extract_response_parts(
        type("Response", (), {"content": "".join(content_parts), "additional_kwargs": {}})()
    )
    thinking = "".join(thinking_parts).strip() or embedded_thinking

    if thinking and not thinking_parts:
        yield {
            "type": "thinking",
            "id": thinking_id,
            "stage": stage,
            "label": thinking_label,
            "text": thinking,
        }

    yield {
        "type": "final",
        "state": _answer_state(answer, thinking),
    }


def _answer_state(answer: str, thinking: str | None) -> dict[str, Any]:
    return {
        "documents": [],
        "analysis": None,
        "analysis_thinking": None,
        "report": None,
        "report_thinking": thinking,
        "answer": answer,
        "result_type": "answer",
        "report_completed": True,
    }


_CODING_ANSWER_PROMPT = """You are a pragmatic senior software engineer helping with coding tasks.

Rules:
- Do not perform web research.
- If the user asks for LeetCode code without a specific problem, provide a concise representative solution and ask for the problem number if they need an exact one.
- Prefer the user's language.
- Include code when useful and keep the explanation focused."""


_DIRECT_ANSWER_PROMPT = """You answer direct user questions without deep-research ceremony.

Rules:
- Do not perform web research.
- If the answer depends on current facts, public identity, prices, laws, schedules, or recent events, say that a web search is needed instead of guessing.
- Prefer the user's language.
- Be concise and useful."""


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
        chain = prompt | llm
        payload = {
            "query": visible_query,
            "report": report,
        }
        config = _langchain_config("artifact-follow-up-llm", "answer")
        response = await ainvoke_langchain(chain, payload, config)
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


def _langchain_config(run_name: str, stage: str) -> dict[str, Any]:
    return get_langfuse_tracer().langchain_config(
        run_name,
        metadata={
            "feature": "deep-research",
            "stage": stage,
        },
    )


def _contains_any(query: str, terms: tuple[str, ...]) -> bool:
    return any(term in query for term in terms)


def _is_likely_direct_answer(query: str) -> bool:
    if _contains_any(query, DIRECT_ANSWER_TERMS) and not _contains_any(query, SOURCE_TERMS):
        return True

    return False


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
