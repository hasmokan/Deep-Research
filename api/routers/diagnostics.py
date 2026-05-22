"""Diagnostics routes for client-side error reporting."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends

from models.schemas import ClientErrorLogRequest
from services.auth import AuthenticatedUser, get_current_user
from services.request_tracing import current_request_id, log_event


router = APIRouter(prefix="/api/diagnostics", tags=["diagnostics"])


@router.post("/client-error")
async def log_client_error(
    request: ClientErrorLogRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """Record a browser/client-side error with request and run context."""
    request_id = current_request_id() or request.request_id
    level = {
        "info": logging.INFO,
        "warning": logging.WARNING,
        "error": logging.ERROR,
    }.get(request.level, logging.ERROR)

    log_event(
        "client_error",
        level=level,
        request_id=request_id,
        user_id=current_user.user_id,
        message=request.message,
        source=request.source,
        url=request.url,
        user_agent=request.user_agent,
        run_id=request.run_id,
        context=request.context,
    )

    return {"ok": True, "request_id": request_id}
