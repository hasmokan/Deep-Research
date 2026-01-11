"""Analyze node - Process and analyze retrieved documents"""

from typing import Any
from langchain_openai import ChatOpenAI
from langchain.prompts import ChatPromptTemplate
from core.config import get_settings

settings = get_settings()


async def analyze_node(state: dict[str, Any]) -> dict[str, Any]:
    """
    Analyze node - process retrieved documents and extract insights

    Args:
        state: Current graph state containing 'query' and 'documents'

    Returns:
        Updated state with 'analysis' field
    """
    query = state["query"]
    documents = state.get("documents", [])

    # If no documents found, skip analysis
    if not documents:
        return {
            "analysis": "No relevant documents found for the given query.",
            "analysis_completed": True
        }

    # Initialize LLM
    llm = ChatOpenAI(
        model="gpt-4o-mini",
        temperature=0.3,
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url
    )

    # Create analysis prompt
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

    # Format documents for the prompt
    formatted_docs = "\n\n".join([
        f"Document {i+1} (Similarity: {doc.get('similarity', 0):.2f}):\n{doc['content']}"
        for i, doc in enumerate(documents)
    ])

    # Generate analysis
    chain = prompt | llm
    response = await chain.ainvoke({
        "query": query,
        "documents": formatted_docs
    })

    return {
        "analysis": response.content,
        "analysis_completed": True
    }
