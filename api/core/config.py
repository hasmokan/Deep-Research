from pydantic_settings import BaseSettings
from functools import lru_cache
from pydantic import field_validator
from typing import Optional

class Settings(BaseSettings):
    supabase_url: str
    supabase_key: str
    openai_api_key: str
    openai_base_url: Optional[str] = None

    @field_validator('supabase_url', 'supabase_key', 'openai_api_key')
    @classmethod
    def strip_whitespace(cls, v: str) -> str:
        """Remove leading/trailing whitespace from string fields"""
        return v.strip() if v else v

    # Vector configuration
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536

    # API configuration
    frontend_url: str = "http://localhost:3000"

    class Config:
        env_file = ".env"
        case_sensitive = False

@lru_cache
def get_settings() -> Settings:
    return Settings()
