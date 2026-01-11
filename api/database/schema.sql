-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Documents table with vector embeddings
CREATE TABLE IF NOT EXISTS documents (
    id BIGSERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    embedding vector(1536),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for vector similarity search (IVFFlat)
-- Note: You may want to switch to HNSW for better query performance
-- HNSW: CREATE INDEX ON documents USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS documents_embedding_idx
ON documents USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Create index for metadata queries
CREATE INDEX IF NOT EXISTS documents_metadata_idx
ON documents USING gin (metadata);

-- Create index for created_at for time-based queries
CREATE INDEX IF NOT EXISTS documents_created_at_idx
ON documents (created_at DESC);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update updated_at
CREATE TRIGGER update_documents_updated_at
BEFORE UPDATE ON documents
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Function for similarity search with threshold
CREATE OR REPLACE FUNCTION match_documents(
    query_embedding vector(1536),
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 10
)
RETURNS TABLE (
    id bigint,
    content text,
    metadata jsonb,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        documents.id,
        documents.content,
        documents.metadata,
        1 - (documents.embedding <=> query_embedding) AS similarity
    FROM documents
    WHERE 1 - (documents.embedding <=> query_embedding) > match_threshold
    ORDER BY documents.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- Research sessions table (optional, for tracking research queries)
CREATE TABLE IF NOT EXISTS research_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    documents_count INT DEFAULT 0,
    report TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for research sessions status
CREATE INDEX IF NOT EXISTS research_sessions_status_idx
ON research_sessions (status);

-- Create index for research sessions created_at
CREATE INDEX IF NOT EXISTS research_sessions_created_at_idx
ON research_sessions (created_at DESC);

-- Trigger for research_sessions updated_at
CREATE TRIGGER update_research_sessions_updated_at
BEFORE UPDATE ON research_sessions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
