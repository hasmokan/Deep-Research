"""Research API routes"""

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from models.schemas import DocumentResponse, ResearchPlanResponse, ResearchRequest, ResearchResponse
from agents.research_agent import research_agent
from agents.research_stream import stream_research_events
from agents.nodes.plan import generate_research_plan
from services.vector_store import get_vector_store
from datetime import datetime
import uuid

router = APIRouter(prefix="/api/research", tags=["research"])


@router.post("/plan", response_model=ResearchPlanResponse)
async def create_research_plan(request: ResearchRequest):
    """
    Generate a query-specific research plan before the full research run.
    """
    try:
        return await generate_research_plan(request.query)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Research plan generation failed: {str(e)}"
        )


@router.get("/stream")
async def stream_research(
    query: str = Query(..., min_length=1, max_length=500),
):
    """
    Execute research and stream progress/results as Server-Sent Events.
    """
    return StreamingResponse(
        stream_research_events(query),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/", response_model=ResearchResponse)
async def create_research(request: ResearchRequest):
    """
    Execute a research query using the LangGraph agent

    Args:
        request: Research request with query text

    Returns:
        Research response with ID, query, status, and document count
    """
    try:
        # Initialize state
        initial_state = {
            "query": request.query,
            "documents": [],
            "analysis": None,
            "analysis_thinking": None,
            "report": None,
            "report_thinking": None,
            "web_search_completed": False,
            "analysis_completed": False,
            "report_completed": False
        }

        # Execute research agent
        result = await research_agent.ainvoke(initial_state)

        # Generate response
        return ResearchResponse(
            id=str(uuid.uuid4()),
            query=result["query"],
            status="completed" if result.get("report_completed") else "failed",
            documents_count=len(result.get("documents", [])),
            created_at=datetime.utcnow().isoformat()
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Research execution failed: {str(e)}"
        )


@router.post("/execute", response_model=dict)
async def execute_research(request: ResearchRequest):
    """
    Execute research and return full results including report

    Args:
        request: Research request with query text

    Returns:
        Complete research results with documents, analysis, and report
    """
    try:
        # Initialize state
        initial_state = {
            "query": request.query,
            "documents": [],
            "analysis": None,
            "analysis_thinking": None,
            "report": None,
            "report_thinking": None,
            "web_search_completed": False,
            "analysis_completed": False,
            "report_completed": False
        }

        # Execute research agent
        result = await research_agent.ainvoke(initial_state)

        # Return full results
        return {
            "query": result["query"],
            "documents": result.get("documents", []),
            "analysis": result.get("analysis"),
            "analysis_thinking": result.get("analysis_thinking"),
            "report": result.get("report"),
            "report_thinking": result.get("report_thinking"),
            "status": "completed" if result.get("report_completed") else "failed"
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Research execution failed: {str(e)}"
        )


@router.get("/documents", response_model=list[DocumentResponse])
async def list_documents(limit: int = 50, offset: int = 0):
    """
    List all documents in the vector database

    Args:
        limit: Maximum number of documents to return
        offset: Number of documents to skip

    Returns:
        List of documents with metadata
    """
    try:
        vector_store = get_vector_store()
        documents = await vector_store.list_documents(limit=limit, offset=offset)

        return [
            DocumentResponse(
                id=doc["id"],
                content=doc["content"],
                metadata=doc.get("metadata", {}),
                similarity=None
            )
            for doc in documents
        ]

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve documents: {str(e)}"
        )


@router.post("/documents")
async def add_document(content: str, metadata: dict = {}):
    """
    Add a new document to the vector database

    Args:
        content: Document text content
        metadata: Optional metadata dictionary

    Returns:
        Created document information
    """
    try:
        vector_store = get_vector_store()
        result = await vector_store.upsert_document(
            content=content,
            metadata=metadata
        )

        return {
            "id": result.get("id"),
            "message": "Document added successfully"
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to add document: {str(e)}"
        )


@router.delete("/documents/{document_id}")
async def delete_document(document_id: int):
    """
    Delete a document from the vector database

    Args:
        document_id: ID of the document to delete

    Returns:
        Deletion status
    """
    try:
        vector_store = get_vector_store()
        success = await vector_store.delete_document(document_id)

        if not success:
            raise HTTPException(
                status_code=404,
                detail=f"Document with ID {document_id} not found"
            )

        return {"message": "Document deleted successfully"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete document: {str(e)}"
        )
