"""Analyze node - Process and analyze retrieved documents"""

from types import SimpleNamespace
from typing import Any
from langchain_openai import ChatOpenAI
from langchain.prompts import ChatPromptTemplate
from core.config import get_settings
from agents.nodes.reasoning import extract_response_delta_parts, extract_response_parts
from services.langfuse_observability import ainvoke_langchain, astream_langchain, get_langfuse_tracer

settings = get_settings()


async def analyze_node(state: dict[str, Any]) -> dict[str, Any]:
    """
    Analyze node - process retrieved documents and extract insights

    Args:
        state: Current graph state containing 'query' and 'documents'

    Returns:
        Updated state with 'analysis' field
    """
    query = _analysis_query(state)
    documents = state.get("documents", [])

    # If no documents found, skip analysis
    if not documents:
        return {
            "analysis": "No relevant documents found for the given query.",
            "analysis_completed": True
        }

    chain = _build_analysis_chain()
    payload = _build_analysis_payload(query, documents)
    config = _langchain_config("analyze-llm", len(documents))
    response = await ainvoke_langchain(chain, payload, config)
    content, thinking = extract_response_parts(response)

    return {
        "analysis": content,
        "analysis_thinking": thinking,
        "analysis_completed": True
    }


async def stream_analyze_node(state: dict[str, Any]):
    """Stream analysis reasoning deltas and yield the final analysis state."""
    query = _analysis_query(state)
    documents = state.get("documents", [])

    if not documents:
        yield {
            "type": "final",
            "state": {
                "analysis": "No relevant documents found for the given query.",
                "analysis_completed": True,
            },
        }
        return

    chain = _build_analysis_chain()
    payload = _build_analysis_payload(query, documents)
    config = _langchain_config("analyze-llm", len(documents))
    content_parts: list[str] = []
    thinking_parts: list[str] = []

    stream = astream_langchain(chain, payload, config)
    async for chunk in stream:
        content_delta, thinking_delta = extract_response_delta_parts(chunk)

        if thinking_delta:
            thinking_parts.append(thinking_delta)
            yield {
                "type": "thinking",
                "id": "analysis-thinking",
                "stage": "analyze",
                "label": "Analysis thinking",
                "text": "".join(thinking_parts).strip(),
            }

        if content_delta:
            content_parts.append(content_delta)
            draft = "".join(content_parts).strip()
            if draft and not thinking_parts:
                yield {
                    "type": "draft",
                    "id": "analysis-draft",
                    "stage": "analyze",
                    "label": "Analysis draft",
                    "text": draft,
                }

    content, embedded_thinking = extract_response_parts(
        SimpleNamespace(content="".join(content_parts), additional_kwargs={})
    )
    thinking = "".join(thinking_parts).strip() or embedded_thinking

    if thinking and not thinking_parts:
        yield {
            "type": "thinking",
            "id": "analysis-thinking",
            "stage": "analyze",
            "label": "Analysis thinking",
            "text": thinking,
        }

    yield {
        "type": "final",
        "state": {
            "analysis": content,
            "analysis_thinking": thinking,
            "analysis_completed": True,
        },
    }


def _build_analysis_chain():
    llm = ChatOpenAI(
        model=settings.llm_model,
        temperature=0.3,
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url,
        extra_body={"reasoning_split": True},
    )
    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are a research analyst. Analyze the provided documents and extract key insights related to the user's query.

Focus on:
1. Main themes and patterns across documents
2. Important facts and statistics
3. Different perspectives or viewpoints
4. Gaps or contradictions in information

Provide a structured analysis in markdown format."""),
        ("user", """Query: {query}

Documents:
{documents}

Please analyze these documents and provide key insights.""")
    ])

    return prompt | llm


def _build_analysis_payload(query: str, documents: list[dict[str, Any]]) -> dict[str, str]:
    formatted_docs = "\n\n".join([
        f"Document {i+1} (Similarity: {doc.get('similarity', 0):.2f}):\n{doc['content']}"
        for i, doc in enumerate(documents)
    ])

    return {
        "query": query,
        "documents": formatted_docs,
    }


def _analysis_query(state: dict[str, Any]) -> str:
    return str(state.get("resolved_query") or state.get("query") or state.get("display_query") or "").strip()


def _langchain_config(run_name: str, documents_count: int) -> dict[str, Any]:
    return get_langfuse_tracer().langchain_config(
        run_name,
        metadata={
            "feature": "deep-research",
            "stage": "analyze",
            "documents_count": documents_count,
        },
    )
