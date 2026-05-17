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
DROP TRIGGER IF EXISTS update_documents_updated_at ON documents;
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
DROP TRIGGER IF EXISTS update_research_sessions_updated_at ON research_sessions;
CREATE TRIGGER update_research_sessions_updated_at
BEFORE UPDATE ON research_sessions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Persisted chat threads for multi-session research conversations
CREATE TABLE IF NOT EXISTS research_threads (
    thread_id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'New chat',
    messages JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS research_threads_updated_at_idx
ON research_threads (updated_at DESC);

DROP TRIGGER IF EXISTS update_research_threads_updated_at ON research_threads;
CREATE TRIGGER update_research_threads_updated_at
BEFORE UPDATE ON research_threads
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Persisted SSE run metadata and append-only event history
CREATE TABLE IF NOT EXISTS research_runs (
    run_id TEXT PRIMARY KEY,
    query TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS research_runs_updated_at_idx
ON research_runs (updated_at DESC);

CREATE INDEX IF NOT EXISTS research_runs_status_idx
ON research_runs (status);

DROP TRIGGER IF EXISTS update_research_runs_updated_at ON research_runs;
CREATE TRIGGER update_research_runs_updated_at
BEFORE UPDATE ON research_runs
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS research_run_events (
    id BIGSERIAL PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES research_runs(run_id) ON DELETE CASCADE,
    event TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    seq INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (run_id, seq)
);

CREATE INDEX IF NOT EXISTS research_run_events_run_seq_idx
ON research_run_events (run_id, seq);

CREATE INDEX IF NOT EXISTS research_run_events_created_at_idx
ON research_run_events (created_at DESC);

-- These tables are intended for server-side access with SUPABASE_SERVICE_KEY.
-- Keep RLS enabled so publishable/anon clients cannot read other users' threads.
ALTER TABLE research_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_run_events ENABLE ROW LEVEL SECURITY;
