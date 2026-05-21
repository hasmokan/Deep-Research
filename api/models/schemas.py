from pydantic import BaseModel, Field
from typing import Any, Literal, Optional


class ConversationMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=12000)


class ResearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500, description="Research query")
    execution_mode: Literal["auto", "react", "report"] = Field(
        default="auto",
        description="Execution style requested by the client",
    )
    thread_id: Optional[str] = Field(
        default=None,
        description="Browser-local conversation identifier used for run context",
    )
    messages: list[ConversationMessage] = Field(
        default_factory=list,
        description="Prior conversation messages used to resolve follow-up research requests",
    )
    latest_result: Optional[dict[str, Any]] = Field(
        default=None,
        description="Most recent completed research artifact for source/report-aware follow-ups",
    )

    class Config:
        json_schema_extra = {
            "example": {
                "query": "Latest trends in artificial intelligence research",
                "execution_mode": "auto",
                "thread_id": None,
                "messages": [],
                "latest_result": None,
            }
        }


class ResearchResponse(BaseModel):
    id: str
    query: str
    status: str
    documents_count: int
    created_at: str


class ResearchPlanStep(BaseModel):
    id: str
    title: str
    detail: str


class ResearchPlanResponse(BaseModel):
    query: str
    source_label: str
    summary: str
    steps: list[ResearchPlanStep]
    should_plan: bool = True


class ResearchThreadUpdate(BaseModel):
    title: str = Field(default="New chat", max_length=120)
    messages: list[dict[str, Any]] = Field(default_factory=list)


class ResearchMemoryResponse(BaseModel):
    user_id: str
    summary: str
    recent_topics: list[dict[str, Any]]
    updated_at: str


class DocumentResponse(BaseModel):
    id: int
    content: str
    metadata: dict
    similarity: Optional[float] = None
