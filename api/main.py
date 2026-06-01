from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os

load_dotenv()

from routers import diagnostics, research, skills
from services.langfuse_observability import get_langfuse_tracer
from services.request_tracing import RequestTracingMiddleware, configure_logging


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    from routers.research import ensure_research_job_worker_started, stop_research_job_worker

    ensure_research_job_worker_started()
    try:
        yield
    finally:
        await stop_research_job_worker()
        get_langfuse_tracer().shutdown()


app = FastAPI(
    title="Deep Research API",
    description="AI-powered deep research tool with intelligent search and report generation",
    version="1.0.0",
    lifespan=lifespan,
)

configure_logging()
app.add_middleware(RequestTracingMiddleware)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        os.getenv("FRONTEND_URL", "http://localhost:3000")
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)

# Include routers
app.include_router(research.router)
app.include_router(skills.router)
app.include_router(diagnostics.router)

@app.get("/")
async def root():
    return {
        "message": "Deep Research API",
        "version": "1.0.0",
        "status": "running"
    }

@app.get("/health")
async def health_check():
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
