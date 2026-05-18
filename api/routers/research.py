"""Research API routes"""

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from models.schemas import DocumentResponse, ResearchMemoryResponse, ResearchPlanResponse, ResearchRequest, ResearchResponse, ResearchThreadUpdate
from agents.research_agent import research_agent
from agents.research_stream import stream_research_events
from agents.conversation_context import build_contextual_research_query
from agents.nodes.plan import assess_research_plan_need, generate_research_plan
from services.auth import AuthenticatedUser, get_current_user
from services.research_memories import build_memory_context, research_memory_store
from services.research_runs import research_run_store
from services.research_threads import research_thread_store
from services.vector_store import get_vector_store
from datetime import datetime
import asyncio
import json
import uuid

router = APIRouter(prefix="/api/research", tags=["research"])
_background_research_tasks: set[asyncio.Task] = set()


def _is_terminal_run_status(status: str | None) -> bool:
    return status in {"completed", "failed", "stopped"}


def _user_id(current_user: AuthenticatedUser) -> str:
    return getattr(current_user, "user_id", "test-user")


def _memory_context_for_user(user_id: str) -> str:
    return build_memory_context(research_memory_store.get_memory(user_id))


def _remember_result(user_id: str, result: dict) -> None:
    research_memory_store.remember_result(user_id, result)


@router.post("/plan", response_model=ResearchPlanResponse)
async def create_research_plan(
    request: ResearchRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
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

        contextual_query = build_contextual_research_query(
            request.query,
            request.messages,
            memory_context=_memory_context_for_user(_user_id(current_user)),
        )
        plan = await generate_research_plan(contextual_query)
        plan["query"] = request.query
        return plan
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Research plan generation failed: {str(e)}"
        )


@router.post("/plan/stream")
async def stream_research_plan(
    request: ResearchRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
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

            contextual_query = build_contextual_research_query(
                request.query,
                request.messages,
                memory_context=_memory_context_for_user(_user_id(current_user)),
            )
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


def _persisted_event_to_sse(event: dict) -> str:
    event_name = str(event.get("event") or "message")
    data = event.get("data") if isinstance(event.get("data"), dict) else {}
    return _format_sse_event(event_name, data)


async def _run_research_to_store(
    contextual_query: str,
    *,
    run_id: str,
    user_id: str,
    display_query: str | None = None,
    latest_result: dict | None = None,
) -> None:
    try:
        async for _event in stream_research_events(
            contextual_query,
            run_id=run_id,
            display_query=display_query,
            store=research_run_store,
            latest_result=latest_result,
            on_complete=lambda result: _remember_result(user_id, result),
        ):
            pass
    except asyncio.CancelledError:
        research_run_store.append_event(run_id, "stopped", {"status": "stopped"})
        raise
    except Exception as exc:
        research_run_store.append_event(
            run_id,
            "stream_error",
            {"detail": f"Research execution failed: {exc}"},
        )


def start_research_run_background(
    contextual_query: str,
    *,
    run_id: str,
    user_id: str,
    display_query: str | None = None,
    latest_result: dict | None = None,
) -> asyncio.Task:
    task = asyncio.create_task(
        _run_research_to_store(
            contextual_query,
            run_id=run_id,
            user_id=user_id,
            display_query=display_query,
            latest_result=latest_result,
        )
    )
    _background_research_tasks.add(task)
    task.add_done_callback(_background_research_tasks.discard)
    return task


async def stream_persisted_research_run_events(
    run_id: str,
    user_id: str,
    store=None,
    after_seq: int = 0,
):
    event_store = store or research_run_store
    next_seq = max(1, after_seq + 1)

    while True:
        run = event_store.get_run(run_id, user_id=user_id)
        if run is None:
            yield _format_sse_event("stream_error", {"detail": f"Research run {run_id} not found"})
            return

        for event in run.get("events", []):
            seq = int(event.get("seq") or 0)
            if seq < next_seq:
                continue
            yield _persisted_event_to_sse(event)
            next_seq = max(next_seq, seq + 1)

        if _is_terminal_run_status(run.get("status")):
            return

        await asyncio.sleep(0.5)


@router.get("/stream")
async def stream_research(
    query: str = Query(..., min_length=1, max_length=500),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Execute research and stream progress/results as Server-Sent Events.
    """
    user_id = _user_id(current_user)
    run = research_run_store.create_run(query, user_id=user_id)
    start_research_run_background(
        query,
        run_id=run["run_id"],
        user_id=user_id,
    )

    return StreamingResponse(
        stream_persisted_research_run_events(run["run_id"], user_id, store=research_run_store),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/stream")
async def stream_research_post(
    request: ResearchRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Execute research and stream progress/results as Server-Sent Events.
    Accepts conversation history in the request body for multi-turn follow-ups.
    """
    user_id = _user_id(current_user)
    contextual_query = build_contextual_research_query(
        request.query,
        request.messages,
        memory_context=_memory_context_for_user(user_id),
    )
    run = research_run_store.create_run(request.query, user_id=user_id)
    start_research_run_background(
        contextual_query,
        run_id=run["run_id"],
        user_id=user_id,
        display_query=request.query,
        latest_result=request.latest_result,
    )

    return StreamingResponse(
        stream_persisted_research_run_events(run["run_id"], user_id, store=research_run_store),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/runs/{run_id}")
async def get_research_run(
    run_id: str,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Return a persisted research run and its SSE event history.
    """
    try:
        run = research_run_store.get_run(run_id, user_id=_user_id(current_user))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if run is None:
        raise HTTPException(status_code=404, detail=f"Research run {run_id} not found")

    return run


@router.get("/runs/{run_id}/stream")
async def stream_research_run(
    run_id: str,
    after_seq: int = Query(0, ge=0),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Subscribe to a persisted research run, replaying prior events before live updates.
    """
    try:
        research_run_store.get_run(run_id, user_id=_user_id(current_user))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return StreamingResponse(
        stream_persisted_research_run_events(
            run_id,
            _user_id(current_user),
            store=research_run_store,
            after_seq=after_seq,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/threads")
async def list_research_threads(
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """List conversation threads for the authenticated user."""
    return research_thread_store.list_threads(_user_id(current_user))


@router.get("/threads/{thread_id}")
async def get_research_thread(
    thread_id: str,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Return a conversation thread for the authenticated user."""
    try:
        thread = research_thread_store.get_thread(_user_id(current_user), thread_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if thread is None:
        raise HTTPException(status_code=404, detail=f"Research thread {thread_id} not found")

    return thread


@router.put("/threads/{thread_id}")
async def save_research_thread(
    thread_id: str,
    request: ResearchThreadUpdate,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Persist a conversation thread for the authenticated user."""
    try:
        return research_thread_store.upsert_thread(
            _user_id(current_user),
            thread_id,
            title=request.title,
            messages=request.messages,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/memory", response_model=ResearchMemoryResponse)
async def get_research_memory(
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Return the authenticated user's long-term research memory."""
    return research_memory_store.get_memory(_user_id(current_user))


@router.post("/", response_model=ResearchResponse)
async def create_research(
    request: ResearchRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Execute a research query using the LangGraph agent

    Args:
        request: Research request with query text

    Returns:
        Research response with ID, query, status, and document count
    """
    try:
        contextual_query = build_contextual_research_query(
            request.query,
            request.messages,
            memory_context=_memory_context_for_user(_user_id(current_user)),
        )
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
async def execute_research(
    request: ResearchRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Execute research and return full results including report

    Args:
        request: Research request with query text

    Returns:
        Complete research results with documents, analysis, and report
    """
    try:
        user_id = _user_id(current_user)
        contextual_query = build_contextual_research_query(
            request.query,
            request.messages,
            memory_context=_memory_context_for_user(user_id),
        )
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
        result_payload = {
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
        _remember_result(user_id, result_payload)
        return result_payload

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
