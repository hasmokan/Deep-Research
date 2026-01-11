"""Search node - Retrieve relevant documents from vector database"""

from typing import Any
from services.vector_store import get_vector_store


async def search_node(state: dict[str, Any]) -> dict[str, Any]:
    """
    Vector search node - retrieve relevant documents from Supabase

    Args:
        state: Current graph state containing 'query'

    Returns:
        Updated state with 'documents' field
    """
    vector_store = get_vector_store()
    query = state["query"]

    # Perform similarity search
    documents = await vector_store.similarity_search(
        query=query,
        threshold=0.6,  # Minimum similarity threshold
        limit=10  # Maximum number of documents to retrieve
    )

    return {
        "documents": documents,
        "search_completed": True
    }
