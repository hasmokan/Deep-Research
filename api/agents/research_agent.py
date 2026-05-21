"""Research agent - LangGraph workflow for deep research"""

from typing import TypedDict, Any, Literal, Optional, List, Dict
from langgraph.graph import StateGraph, END
from agents.nodes.conversation_router import (
    answer_coding_node,
    answer_direct_node,
    answer_from_artifact_node,
    answer_sources_node,
    classify_research_intent_node,
    route_research_intent,
)
from agents.nodes.query_resolution import resolve_research_query_node
from agents.nodes.web_search import web_search_node
from agents.nodes.analyze import analyze_node
from agents.nodes.generate import generate_node


class ResearchState(TypedDict):
    """State definition for research agent"""
    query: str
    display_query: Optional[str]
    documents: List[Dict[str, Any]]
    analysis: Optional[str]
    analysis_thinking: Optional[str]
    report: Optional[str]
    report_thinking: Optional[str]
    latest_result: Optional[Dict[str, Any]]
    resolved_query: Optional[str]
    search_query: Optional[str]
    context_resolution: Optional[Dict[str, Any]]
    intent: Optional[str]
    answer: Optional[str]
    result_type: Optional[str]
    web_search_completed: bool
    analysis_completed: bool
    report_completed: bool


def should_analyze(state: ResearchState) -> Literal["analyze", "end"]:
    """
    Determine if analysis should proceed based on search results

    Args:
        state: Current research state

    Returns:
        Next node to execute: "analyze" if documents found, "end" otherwise
    """
    if state.get("web_search_completed") and len(state.get("documents", [])) > 0:
        return "analyze"
    return "end"


def should_generate(state: ResearchState) -> Literal["generate", "end"]:
    """
    Determine if report generation should proceed based on analysis

    Args:
        state: Current research state

    Returns:
        Next node to execute: "generate" if analysis completed, "end" otherwise
    """
    if state.get("analysis_completed") and state.get("analysis"):
        return "generate"
    return "end"


def build_research_graph() -> Any:
    """
    Build and compile the research agent graph

    Returns:
        Compiled LangGraph workflow
    """
    # Initialize graph with state schema
    graph = StateGraph(ResearchState)

    # Add nodes
    graph.add_node("resolve_query", resolve_research_query_node)
    graph.add_node("classify_intent", classify_research_intent_node)
    graph.add_node("answer_sources", answer_sources_node)
    graph.add_node("answer_from_artifact", answer_from_artifact_node)
    graph.add_node("answer_coding", answer_coding_node)
    graph.add_node("answer_direct", answer_direct_node)
    graph.add_node("web_search", web_search_node)
    graph.add_node("analyze", analyze_node)
    graph.add_node("generate", generate_node)

    graph.set_entry_point("resolve_query")
    graph.add_edge("resolve_query", "classify_intent")

    # Add conditional edges
    graph.add_conditional_edges(
        "classify_intent",
        route_research_intent,
        {
            "answer_sources": "answer_sources",
            "answer_from_artifact": "answer_from_artifact",
            "answer_coding": "answer_coding",
            "answer_direct": "answer_direct",
            "web_search": "web_search",
        }
    )

    graph.add_conditional_edges(
        "web_search",
        should_analyze,
        {
            "analyze": "analyze",
            "end": END
        }
    )

    graph.add_conditional_edges(
        "analyze",
        should_generate,
        {
            "generate": "generate",
            "end": END
        }
    )

    # Final edge from generate to end
    graph.add_edge("answer_sources", END)
    graph.add_edge("answer_from_artifact", END)
    graph.add_edge("answer_coding", END)
    graph.add_edge("answer_direct", END)
    graph.add_edge("generate", END)

    return graph.compile()


# Create singleton research agent instance
research_agent = build_research_graph()
