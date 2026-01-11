# Backend Development Guide

Python backend development guidelines based on FastAPI + LangGraph + Supabase.

## Tech Stack

- **Language**: Python 3.11+
- **Framework**: FastAPI
- **AI Orchestration**: LangGraph
- **Vector Database**: Supabase (pgvector)
- **Async**: asyncio + httpx

## Directory Structure

```
api/
├── main.py                  # FastAPI application entry
├── agents/                  # LangGraph agents
│   ├── research_agent.py   # Research agent
│   └── nodes/              # Agent node functions
│       ├── search.py
│       ├── analyze.py
│       └── generate.py
├── services/                # Business logic layer
│   ├── vector_store.py     # Supabase vector operations
│   └── embedding.py        # Embedding generation
├── routers/                 # FastAPI routers
│   ├── research.py
│   └── reports.py
├── models/                  # Pydantic models
│   ├── requests.py
│   └── responses.py
└── core/                    # Core configuration
    ├── config.py           # Environment variable config
    └── dependencies.py     # Dependency injection
```

---

## 1. Code Conventions

### Type Annotations (Required)

```python
from typing import TypedDict

# ✅ Complete type annotations
async def search_documents(
    query: str,
    limit: int = 10,
    threshold: float = 0.7
) -> list[Document]:
    ...

# ✅ TypedDict for complex structures
class Document(TypedDict):
    id: int
    content: str
    metadata: dict
    similarity: float | None
```

### Async-First

```python
# ✅ Use async/await for I/O operations
async def fetch_data(url: str) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.get(url)
        return response.json()

# ❌ Avoid synchronous blocking calls in async functions
def fetch_data_sync(url: str) -> dict:  # Will block event loop
    return requests.get(url).json()
```

---

## 2. LangGraph Agent Structure

### State Definition

```python
# agents/research_agent.py
from typing import TypedDict, Annotated
from langgraph.graph import StateGraph, END

class ResearchState(TypedDict):
    query: str                      # User query
    documents: list[Document]       # Retrieved documents
    analysis: str | None            # Analysis result
    report: str | None              # Final report
```

### Node Functions

```python
# agents/nodes/search.py
from services.vector_store import vector_store

async def search_node(state: ResearchState) -> dict:
    """Vector search node - retrieve relevant documents from Supabase"""
    documents = await vector_store.similarity_search(
        query=state["query"],
        threshold=0.6,
        limit=5
    )
    return {"documents": documents}
```

### Graph Construction

```python
# agents/research_agent.py
def build_research_graph():
    graph = StateGraph(ResearchState)

    # Add nodes
    graph.add_node("search", search_node)
    graph.add_node("analyze", analyze_node)
    graph.add_node("generate", generate_node)

    # Set entry point
    graph.set_entry_point("search")

    # Conditional routing
    graph.add_conditional_edges(
        "search",
        should_continue,
        {
            "has_docs": "analyze",
            "no_docs": END
        }
    )
    graph.add_edge("analyze", "generate")
    graph.add_edge("generate", END)

    return graph.compile()

research_agent = build_research_graph()
```

---

## 3. Supabase Vector Operations

### Service Wrapper

```python
# services/vector_store.py
from supabase import create_client, Client
from openai import AsyncOpenAI
import os

class VectorStore:
    def __init__(self):
        self.supabase: Client = create_client(
            os.environ["SUPABASE_URL"],
            os.environ["SUPABASE_SERVICE_KEY"]
        )
        self.openai = AsyncOpenAI()

    async def get_embedding(self, text: str) -> list[float]:
        """Generate text embedding"""
        response = await self.openai.embeddings.create(
            model="text-embedding-3-small",
            input=text
        )
        return response.data[0].embedding

    async def upsert_document(
        self,
        content: str,
        metadata: dict = {}
    ) -> int:
        """Store document and its embedding"""
        embedding = await self.get_embedding(content)
        result = self.supabase.table("documents").insert({
            "content": content,
            "metadata": metadata,
            "embedding": embedding
        }).execute()
        return result.data[0]["id"]

    async def similarity_search(
        self,
        query: str,
        threshold: float = 0.7,
        limit: int = 10
    ) -> list[Document]:
        """Vector similarity search"""
        query_embedding = await self.get_embedding(query)
        result = self.supabase.rpc(
            "match_documents",
            {
                "query_embedding": query_embedding,
                "match_threshold": threshold,
                "match_count": limit
            }
        ).execute()
        return result.data

# Singleton instance
vector_store = VectorStore()
```

### Supabase SQL Functions

```sql
-- Execute in Supabase SQL Editor
create extension if not exists vector;

create table documents (
  id bigserial primary key,
  content text not null,
  metadata jsonb default '{}',
  embedding vector(1536),
  created_at timestamptz default now()
);

-- Vector search function
create or replace function match_documents(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 10
)
returns table (
  id bigint,
  content text,
  metadata jsonb,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    d.id,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) as similarity
  from documents d
  where 1 - (d.embedding <=> query_embedding) > match_threshold
  order by d.embedding <=> query_embedding
  limit match_count;
end;
$$;
```

---

## 4. FastAPI Routes

### Basic Routes

```python
# routers/research.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from agents.research_agent import research_agent

router = APIRouter(prefix="/api/research", tags=["research"])

class ResearchRequest(BaseModel):
    query: str

class ResearchResponse(BaseModel):
    query: str
    documents_count: int
    report: str | None

@router.post("/", response_model=ResearchResponse)
async def run_research(request: ResearchRequest):
    """Execute research query"""
    result = await research_agent.ainvoke({
        "query": request.query,
        "documents": [],
        "analysis": None,
        "report": None
    })

    return ResearchResponse(
        query=result["query"],
        documents_count=len(result["documents"]),
        report=result["report"]
    )
```

### Streaming Response

```python
# routers/research.py
from fastapi.responses import StreamingResponse
import json

@router.post("/stream")
async def stream_research(request: ResearchRequest):
    """Stream research results"""
    async def generate():
        async for event in research_agent.astream_events(
            {
                "query": request.query,
                "documents": [],
                "analysis": None,
                "report": None
            },
            version="v2"
        ):
            if event["event"] == "on_chain_end":
                yield f"data: {json.dumps(event['data'])}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream"
    )
```

---

## 5. Error Handling

```python
# core/exceptions.py
from fastapi import HTTPException

class VectorStoreError(Exception):
    """Vector store related errors"""
    pass

class AgentError(Exception):
    """Agent execution errors"""
    pass

# Usage in routes
@router.post("/")
async def run_research(request: ResearchRequest):
    try:
        result = await research_agent.ainvoke(...)
    except VectorStoreError as e:
        raise HTTPException(status_code=503, detail=f"Vector store unavailable: {e}")
    except AgentError as e:
        raise HTTPException(status_code=500, detail=f"Agent execution failed: {e}")
```

---

## 6. Configuration Management

```python
# core/config.py
from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    supabase_url: str
    supabase_service_key: str
    openai_api_key: str

    # Vector configuration
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536

    class Config:
        env_file = ".env"

@lru_cache
def get_settings() -> Settings:
    return Settings()
```

---

## Common Commands

```bash
# Development server
uvicorn main:app --reload --port 8000

# Type checking
mypy api/

# Code formatting
ruff format api/

# Linting
ruff check api/
```

## Environment Variables

```bash
# .env
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
OPENAI_API_KEY=sk-...
```

## Important Notes

- Use embedding dimension 1536 (OpenAI text-embedding-3-small)
- Frontend-backend communication uses JSON, dates in ISO 8601 format
- Never commit sensitive information (API keys) to the repository
