from pydantic_settings import BaseSettings
from functools import lru_cache
from pydantic import field_validator
from typing import Optional

class Settings(BaseSettings):
    supabase_url: str
    supabase_key: str
    supabase_service_key: Optional[str] = None
    openai_api_key: str
    openai_base_url: Optional[str] = None
    llm_model: str = "minimax/minimax-m2.7"

    @field_validator('supabase_url', 'supabase_key', 'openai_api_key')
    @classmethod
    def strip_whitespace(cls, v: str) -> str:
        """Remove leading/trailing whitespace from string fields"""
        return v.strip() if v else v

    # Vector configuration
    embedding_model: str = "openai/text-embedding-3-small"
    embedding_dimensions: int = 1536

    # API configuration
    frontend_url: str = "http://localhost:3000"
    research_storage_backend: str = "json"
    agent_skills_dir: Optional[str] = None
    agent_enabled_skills: str = ""

    # Langfuse observability
    langfuse_enabled: bool = False
    langfuse_public_key: Optional[str] = None
    langfuse_secret_key: Optional[str] = None
    langfuse_base_url: Optional[str] = None
    langfuse_environment: str = "development"
    langfuse_release: Optional[str] = None
    langfuse_sample_rate: float = 1.0

    class Config:
        env_file = ".env"
        case_sensitive = False

@lru_cache
def get_settings() -> Settings:
    return Settings()
