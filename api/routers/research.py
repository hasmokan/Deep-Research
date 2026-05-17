"""Research API routes"""

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from models.schemas import DocumentResponse, ResearchPlanResponse, ResearchRequest, ResearchResponse
from agents.research_agent import research_agent
from agents.research_stream import stream_research_events
from agents.conversation_context import build_contextual_research_query
from agents.nodes.plan import assess_research_plan_need, generate_research_plan
from services.research_runs import research_run_store
from services.vector_store import get_vector_store
from datetime import datetime
import json
import uuid

router = APIRouter(prefix="/api/research", tags=["research"])


def _raise_thread_persistence_disabled() -> None:
    raise HTTPException(
        status_code=410,
        detail="Server-side research thread persistence is disabled. Conversation history is stored in browser localStorage.",
    )


@router.post("/plan", response_model=ResearchPlanResponse)
async def create_research_plan(request: ResearchRequest):
    """
    Generate a query-specific research plan before the full research run.
    """
    try:
        has_follow_up_context = bool(request.messages) or bool(request.latest_result)

        if has_follow_up_context:
            plan_need = await assess_research_plan_need(request.query)

            if not plan_need["should_plan"]:
                return ResearchPlanResponse(
                    query=request.query,
                    source_label="Conversation",
                    summary=plan_need.get("reason") or "This follow-up can be answered directly.",
                    steps=[],
                    should_plan=False,
                )

        contextual_query = build_contextual_research_query(request.query, request.messages)
        plan = await generate_research_plan(contextual_query)
        plan["query"] = request.query
        return plan
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Research plan generation failed: {str(e)}"
        )


@router.post("/plan/stream")
async def stream_research_plan(request: ResearchRequest):
    """
    Generate a query-specific research plan and stream plan progress as SSE.
    """
    async def events():
        try:
            yield _format_sse_event(
                "status",
                {
                    "stage": "plan",
                    "label": "Planning",
                    "message": "Clarifying the research objective and context.",
                },
            )

            has_follow_up_context = bool(request.messages) or bool(request.latest_result)

            if has_follow_up_context:
                plan_need = await assess_research_plan_need(request.query)

                if not plan_need["should_plan"]:
                    payload = {
                        "query": request.query,
                        "source_label": "Conversation",
                        "summary": plan_need.get("reason") or "This follow-up can be answered directly.",
                        "steps": [],
                        "should_plan": False,
                    }
                    yield _format_sse_event("plan", payload)
                    yield _format_sse_event("complete", payload)
                    return

            yield _format_sse_event(
                "status",
                {
                    "stage": "plan",
                    "label": "Drafting plan",
                    "message": "Structuring source discovery, evidence comparison, and report synthesis.",
                },
            )

            contextual_query = build_contextual_research_query(request.query, request.messages)
            plan = await generate_research_plan(contextual_query)
            payload = {**plan, "query": request.query, "should_plan": True}

            yield _format_sse_event("plan", payload)
            yield _format_sse_event("complete", payload)
        except Exception as exc:
            yield _format_sse_event(
                "stream_error",
                {"detail": f"Research plan generation failed: {exc}"},
            )

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _format_sse_event(event: str, data: dict) -> str:
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\ndata: {payload}\n\n"


@router.get("/stream")
async def stream_research(
    query: str = Query(..., min_length=1, max_length=500),
):
    """
    Execute research and stream progress/results as Server-Sent Events.
    """
    run = research_run_store.create_run(query)

    async def events():
        yield f'event: metadata\ndata: {{"run_id":"{run["run_id"]}"}}\n\n'
        async for event in stream_research_events(
            query,
            run_id=run["run_id"],
            store=research_run_store,
        ):
            yield event

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/stream")
async def stream_research_post(request: ResearchRequest):
    """
    Execute research and stream progress/results as Server-Sent Events.
    Accepts conversation history in the request body for multi-turn follow-ups.
    """
    contextual_query = build_contextual_research_query(request.query, request.messages)
    run = research_run_store.create_run(request.query)

    async def events():
        yield f'event: metadata\ndata: {{"run_id":"{run["run_id"]}"}}\n\n'
        async for event in stream_research_events(
            contextual_query,
            run_id=run["run_id"],
            display_query=request.query,
            store=research_run_store,
            latest_result=request.latest_result,
        ):
            yield event

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/runs/{run_id}")
async def get_research_run(run_id: str):
    """
    Return a persisted research run and its SSE event history.
    """
    try:
        run = research_run_store.get_run(run_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if run is None:
        raise HTTPException(status_code=404, detail=f"Research run {run_id} not found")

    return run


@router.get("/threads")
async def list_research_threads():
    """Server-side conversation thread persistence is disabled."""
    _raise_thread_persistence_disabled()


@router.get("/threads/{thread_id}")
async def get_research_thread(thread_id: str):
    """Server-side conversation thread persistence is disabled."""
    _raise_thread_persistence_disabled()


@router.put("/threads/{thread_id}")
async def save_research_thread(thread_id: str):
    """Server-side conversation thread persistence is disabled."""
    _raise_thread_persistence_disabled()


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
        contextual_query = build_contextual_research_query(request.query, request.messages)
        initial_state = {
            "query": contextual_query,
            "display_query": request.query,
            "documents": [],
            "analysis": None,
            "analysis_thinking": None,
            "report": None,
            "report_thinking": None,
            "latest_result": request.latest_result,
            "intent": None,
            "answer": None,
            "result_type": "report",
            "web_search_completed": False,
            "analysis_completed": False,
            "report_completed": False
        }

        # Execute research agent
        result = await research_agent.ainvoke(initial_state)

        # Generate response
        return ResearchResponse(
            id=str(uuid.uuid4()),
            query=request.query,
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
        contextual_query = build_contextual_research_query(request.query, request.messages)
        initial_state = {
            "query": contextual_query,
            "display_query": request.query,
            "documents": [],
            "analysis": None,
            "analysis_thinking": None,
            "report": None,
            "report_thinking": None,
            "latest_result": request.latest_result,
            "intent": None,
            "answer": None,
            "result_type": "report",
            "web_search_completed": False,
            "analysis_completed": False,
            "report_completed": False
        }

        # Execute research agent
        result = await research_agent.ainvoke(initial_state)

        # Return full results
        return {
            "query": request.query,
            "documents": result.get("documents", []),
            "analysis": result.get("analysis"),
            "analysis_thinking": result.get("analysis_thinking"),
            "report": result.get("report"),
            "report_thinking": result.get("report_thinking"),
            "answer": result.get("answer"),
            "result_type": result.get("result_type") or "report",
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
