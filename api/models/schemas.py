from pydantic import BaseModel, Field
from typing import Optional

class ResearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500, description="Research query")

    class Config:
        json_schema_extra = {
            "example": {
                "query": "Latest trends in artificial intelligence research"
            }
        }

class ResearchResponse(BaseModel):
    id: str
    query: str
    status: str
    documents_count: int
    created_at: str

class DocumentResponse(BaseModel):
    id: int
    content: str
    metadata: dict
    similarity: Optional[float] = None
