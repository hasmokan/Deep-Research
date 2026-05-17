from pydantic import BaseModel, Field
from typing import Any, Literal, Optional


class ConversationMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=12000)


class ResearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500, description="Research query")
    thread_id: Optional[str] = Field(
        default=None,
        description="Conversation thread identifier for server-side persistence",
    )
    messages: list[ConversationMessage] = Field(
        default_factory=list,
        description="Prior conversation messages used to resolve follow-up research requests",
    )

    class Config:
        json_schema_extra = {
            "example": {
                "query": "Latest trends in artificial intelligence research",
                "thread_id": None,
                "messages": [],
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
    title: str = Field(default="New chat", max_length=200)
    messages: list[dict[str, Any]] = Field(default_factory=list)


class DocumentResponse(BaseModel):
    id: int
    content: str
    metadata: dict
    similarity: Optional[float] = None
