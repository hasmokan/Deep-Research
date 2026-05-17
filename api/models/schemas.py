from pydantic import BaseModel, Field
from typing import Any, Literal, Optional


class ConversationMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=12000)


class ResearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500, description="Research query")
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


class DocumentResponse(BaseModel):
    id: int
    content: str
    metadata: dict
    similarity: Optional[float] = None
