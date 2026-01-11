"""Vector store service for Supabase + pgvector operations"""

from typing import Any, Optional, Dict, List
from supabase import create_client, Client
from openai import AsyncOpenAI
from core.config import get_settings

settings = get_settings()


class VectorStore:
    """Service for managing vector embeddings and similarity search"""

    def __init__(self):
        self.supabase: Client = create_client(
            settings.supabase_url, settings.supabase_key
        )
        self.openai_client = AsyncOpenAI(
            api_key=settings.openai_api_key,
            base_url=settings.openai_base_url
        )
        self.embedding_model = settings.embedding_model
        self.embedding_dimensions = settings.embedding_dimensions

    async def get_embedding(self, text: str) -> List[float]:
        """
        Generate embedding vector for given text using OpenAI API

        Args:
            text: Input text to embed

        Returns:
            List of floats representing the embedding vector
        """
        response = await self.openai_client.embeddings.create(
            model=self.embedding_model, input=text, encoding_format="float"
        )
        return response.data[0].embedding

    async def upsert_document(
        self,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
        document_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Insert or update a document with its embedding

        Args:
            content: Document text content
            metadata: Optional metadata dictionary
            document_id: Optional ID for update operation

        Returns:
            Inserted/updated document data
        """
        embedding = await self.get_embedding(content)

        document_data = {
            "content": content,
            "metadata": metadata or {},
            "embedding": embedding,
        }

        if document_id:
            # Update existing document
            response = (
                self.supabase.table("documents")
                .update(document_data)
                .eq("id", document_id)
                .execute()
            )
        else:
            # Insert new document
            response = self.supabase.table("documents").insert(document_data).execute()

        return response.data[0] if response.data else {}

    async def similarity_search(
        self, query: str, threshold: float = 0.7, limit: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Perform similarity search using vector embeddings

        Args:
            query: Search query text
            threshold: Minimum similarity threshold (0-1)
            limit: Maximum number of results

        Returns:
            List of matching documents with similarity scores
        """
        query_embedding = await self.get_embedding(query)

        response = self.supabase.rpc(
            "match_documents",
            {
                "query_embedding": query_embedding,
                "match_threshold": threshold,
                "match_count": limit,
            },
        ).execute()

        return response.data if response.data else []

    async def get_document(self, document_id: int) -> Optional[Dict[str, Any]]:
        """
        Retrieve a single document by ID

        Args:
            document_id: Document ID

        Returns:
            Document data or None if not found
        """
        response = (
            self.supabase.table("documents").select("*").eq("id", document_id).execute()
        )

        return response.data[0] if response.data else None

    async def delete_document(self, document_id: int) -> bool:
        """
        Delete a document by ID

        Args:
            document_id: Document ID to delete

        Returns:
            True if deleted successfully
        """
        response = (
            self.supabase.table("documents").delete().eq("id", document_id).execute()
        )

        return len(response.data) > 0

    async def list_documents(
        self, limit: int = 50, offset: int = 0
    ) -> List[Dict[str, Any]]:
        """
        List all documents with pagination

        Args:
            limit: Number of documents to return
            offset: Number of documents to skip

        Returns:
            List of documents
        """
        response = (
            self.supabase.table("documents")
            .select("id, content, metadata, created_at")
            .order("created_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )

        return response.data if response.data else []


# Singleton instance
_vector_store: Optional[VectorStore] = None


def get_vector_store() -> VectorStore:
    """Get or create VectorStore singleton instance"""
    global _vector_store
    if _vector_store is None:
        _vector_store = VectorStore()
    return _vector_store
