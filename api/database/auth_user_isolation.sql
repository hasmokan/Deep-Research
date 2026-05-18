-- Run this once in Supabase SQL Editor when upgrading an existing deployment
-- from browser-local chats to Google-authenticated per-user storage.

ALTER TABLE research_threads
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Old browser-local rows cannot be safely attributed to a Google account.
-- Remove them before making user_id mandatory.
DELETE FROM research_threads WHERE user_id IS NULL;

ALTER TABLE research_threads
ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE research_threads
DROP CONSTRAINT IF EXISTS research_threads_pkey;

ALTER TABLE research_threads
ADD CONSTRAINT research_threads_pkey PRIMARY KEY (user_id, thread_id);

CREATE INDEX IF NOT EXISTS research_threads_user_updated_at_idx
ON research_threads (user_id, updated_at DESC);

ALTER TABLE research_runs
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Old anonymous run logs are not attributable after enabling auth.
DELETE FROM research_runs WHERE user_id IS NULL;

ALTER TABLE research_runs
ALTER COLUMN user_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS research_runs_user_updated_at_idx
ON research_runs (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS research_memories (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    summary TEXT NOT NULL DEFAULT '',
    recent_topics JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_research_memories_updated_at ON research_memories;
CREATE TRIGGER update_research_memories_updated_at
BEFORE UPDATE ON research_memories
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE research_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_run_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_memories ENABLE ROW LEVEL SECURITY;
