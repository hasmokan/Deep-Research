"""Generate node - Create final research report"""

from typing import Any
from langchain_openai import ChatOpenAI
from langchain.prompts import ChatPromptTemplate
from core.config import get_settings

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
    analysis = state.get("analysis", "")
    documents_count = len(state.get("documents", []))

    # If no analysis available, return a simple message
    if not analysis or "No relevant documents" in analysis:
        return {
            "report": f"# Research Report: {query}\n\nNo relevant documents found. Please try a different query or add more documents to the database.",
            "report_completed": True
        }

    # Initialize LLM
    llm = ChatOpenAI(
        model="gpt-4o",
        temperature=0.5,
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url
    )

    # Create report generation prompt
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
        ("user", """Research Query: {query}

Analysis:
{analysis}

Number of documents analyzed: {documents_count}

Please generate a comprehensive research report.""")
    ])

    # Generate report
    chain = prompt | llm
    response = await chain.ainvoke({
        "query": query,
        "analysis": analysis,
        "documents_count": documents_count
    })

    return {
        "report": response.content,
        "report_completed": True
    }
