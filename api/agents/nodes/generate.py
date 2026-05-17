"""Generate node - Create final research report"""

from types import SimpleNamespace
from typing import Any
from langchain_openai import ChatOpenAI
from langchain.prompts import ChatPromptTemplate
from core.config import get_settings
from agents.nodes.reasoning import extract_response_delta_parts, extract_response_parts

settings = get_settings()


async def generate_node(state: dict[str, Any]) -> dict[str, Any]:
    """
    Generate node - create comprehensive research report

    Args:
        state: Current graph state containing 'query', 'documents', and 'analysis'

    Returns:
        Updated state with 'report' field
    """
    query = state["query"]
    display_query = state.get("display_query") or query
    analysis = state.get("analysis", "")
    documents_count = len(state.get("documents", []))

    # If no analysis available, return a simple message
    if not analysis or "No relevant documents" in analysis:
        return {
            "report": f"# Research Report: {display_query}\n\nNo relevant documents found. Please try a different query or add more documents to the database.",
            "report_completed": True
        }

    chain = _build_generate_chain()
    response = await chain.ainvoke(_build_generate_payload(query, display_query, analysis, documents_count))
    content, thinking = extract_response_parts(response)

    return {
        "report": content,
        "report_thinking": thinking,
        "report_completed": True
    }


async def stream_generate_node(state: dict[str, Any]):
    """Stream report-writing reasoning deltas and yield the final report state."""
    query = state["query"]
    display_query = state.get("display_query") or query
    analysis = state.get("analysis", "")
    documents_count = len(state.get("documents", []))

    if not analysis or "No relevant documents" in analysis:
        yield {
            "type": "final",
            "state": {
                "report": f"# Research Report: {display_query}\n\nNo relevant documents found. Please try a different query or add more documents to the database.",
                "report_completed": True,
            },
        }
        return

    chain = _build_generate_chain()
    content_parts: list[str] = []
    thinking_parts: list[str] = []

    async for chunk in chain.astream(_build_generate_payload(query, display_query, analysis, documents_count)):
        content_delta, thinking_delta = extract_response_delta_parts(chunk)

        if thinking_delta:
            thinking_parts.append(thinking_delta)
            yield {
                "type": "thinking",
                "id": "report-thinking",
                "stage": "report",
                "label": "Report thinking",
                "text": "".join(thinking_parts).strip(),
            }

        if content_delta:
            content_parts.append(content_delta)

    content, embedded_thinking = extract_response_parts(
        SimpleNamespace(content="".join(content_parts), additional_kwargs={})
    )
    thinking = "".join(thinking_parts).strip() or embedded_thinking

    if thinking and not thinking_parts:
        yield {
            "type": "thinking",
            "id": "report-thinking",
            "stage": "report",
            "label": "Report thinking",
            "text": thinking,
        }

    yield {
        "type": "final",
        "state": {
            "report": content,
            "report_thinking": thinking,
            "report_completed": True,
        },
    }


def _build_generate_chain():
    llm = ChatOpenAI(
        model=settings.llm_model,
        temperature=0.5,
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url,
        extra_body={"reasoning_split": True},
    )
    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are a professional research report writer. Create a comprehensive, well-structured research report based on the analysis provided.

The report should include:
1. **Executive Summary**: Brief overview of key findings
2. **Introduction**: Context and background of the research query
3. **Main Findings**: Detailed insights organized by themes
4. **Key Takeaways**: Bullet points of the most important points
5. **Conclusion**: Summary and potential implications

Use markdown formatting with proper headings, bullet points, and emphasis where appropriate.
Write in a professional, objective tone."""),
        ("user", """User-Facing Research Request: {display_query}

Conversation-Aware Research Query:
{query}

Analysis:
{analysis}

Number of documents analyzed: {documents_count}

Please generate a comprehensive research report.""")
    ])

    return prompt | llm


def _build_generate_payload(
    query: str,
    display_query: str,
    analysis: str,
    documents_count: int,
) -> dict[str, str | int]:
    return {
        "query": query,
        "display_query": display_query,
        "analysis": analysis,
        "documents_count": documents_count,
    }
