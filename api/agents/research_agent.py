"""Research agent - LangGraph workflow for deep research"""

from typing import TypedDict, Any, Literal, Optional, List, Dict
from langgraph.graph import StateGraph, END
from agents.nodes.web_search import web_search_node
from agents.nodes.analyze import analyze_node
from agents.nodes.generate import generate_node


class ResearchState(TypedDict):
    """State definition for research agent"""
    query: str
    documents: List[Dict[str, Any]]
    analysis: Optional[str]
    report: Optional[str]
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
    graph.add_node("web_search", web_search_node)
    graph.add_node("analyze", analyze_node)
    graph.add_node("generate", generate_node)

    # Set entry point - now starts with web search
    graph.set_entry_point("web_search")

    # Add conditional edges
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
    graph.add_edge("generate", END)

    return graph.compile()


# Create singleton research agent instance
research_agent = build_research_graph()
