# Database Setup Guide

## Prerequisites

1. Create a Supabase project at [https://supabase.com](https://supabase.com)
2. Get your project URL, publishable key, and service key from Settings > API
3. Enable Google in Authentication > Providers after creating a Google OAuth client

## Setup Steps

### 1. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env`:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-publishable-key
SUPABASE_SERVICE_KEY=your-service-key
OPENAI_API_KEY=your-openai-api-key
FRONTEND_URL=http://localhost:3000
RESEARCH_STORAGE_BACKEND=supabase
```

`SUPABASE_SERVICE_KEY` is used only by the backend. It is required for persisted
research threads/runs because the schema enables RLS on those tables and does not
grant public policies.

For the Next.js frontend, create `web/.env.local` from `web/.env.example`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

Only publishable Supabase keys belong in `NEXT_PUBLIC_*` variables. Never put
`SUPABASE_SERVICE_KEY` in Vercel or any browser-visible frontend environment.

### 2. Run Database Schema

Execute the SQL schema in your Supabase project:

**Option A: Supabase Dashboard**
1. Go to your Supabase project dashboard
2. Navigate to SQL Editor
3. Copy the contents of `api/database/schema.sql`
4. Paste and execute

**Option B: Supabase CLI**
```bash
supabase db push
```

For an existing deployment that already created the old anonymous
`research_threads` or `research_runs` tables, run
`api/database/auth_user_isolation.sql` once in the SQL Editor instead. It drops
old anonymous thread/run rows because they cannot be safely assigned to a Google
account.

### 3. Configure Google OAuth

1. In Google Cloud Console, create an OAuth Web Client.
2. Add this authorized redirect URI:
   `https://<your-project-ref>.supabase.co/auth/v1/callback`
3. In Supabase Authentication > Providers > Google, paste the Google Client ID
   and Client Secret and enable the provider.
4. In Supabase Authentication > URL Configuration, add these redirect URLs:
   - `http://localhost:3000/auth/callback`
   - `https://your-vercel-domain.vercel.app/auth/callback`

### 4. Verify Setup

After running the schema, you should have:

**Tables:**
- `documents` - Stores document content with vector embeddings
- `research_sessions` - Tracks research queries and results
- `research_threads` - Persists chat sessions and messages
- `research_runs` - Persists research run metadata
- `research_run_events` - Persists streaming run events for restore/replay
- `research_memories` - Persists per-user long-term memo summaries

**Indexes:**
- `documents_embedding_idx` - IVFFlat index for fast vector similarity search
- `documents_metadata_idx` - GIN index for metadata queries
- `documents_created_at_idx` - Index for time-based queries
- `research_threads_updated_at_idx` - Sorts recent chat sessions
- `research_run_events_run_seq_idx` - Restores run events in stream order

**Functions:**
- `match_documents()` - Performs similarity search with threshold
- `update_updated_at_column()` - Automatically updates timestamps

### 5. Test Connection

Run the FastAPI server:
```bash
cd api
pip install -r requirements.txt
uvicorn main:app --reload
```

Visit: http://localhost:8000/health

To keep using local JSON files for sessions and run events during development,
leave `RESEARCH_STORAGE_BACKEND=json`. To persist them in Supabase for deployment,
set `RESEARCH_STORAGE_BACKEND=supabase`.

## Vector Search Configuration

The schema uses **IVFFlat** indexing by default. For production, consider switching to **HNSW** for better performance:

```sql
-- Replace the IVFFlat index with HNSW
DROP INDEX IF EXISTS documents_embedding_idx;
CREATE INDEX documents_embedding_idx
ON documents USING hnsw (embedding vector_cosine_ops);
```

**Performance Comparison:**
- **IVFFlat**: Faster indexing, good for frequently updated data
- **HNSW**: Faster queries, better for read-heavy workloads

## Embedding Dimensions

Current setup uses **1536 dimensions** (`openai/text-embedding-3-small`).

If switching to a different model:
1. Update `embedding_dimensions` in `api/core/config.py`
2. Modify the vector dimension in `schema.sql`:
   ```sql
   embedding vector(YOUR_DIMENSION)
   ```
3. Recreate the documents table

## Troubleshooting

**Error: "extension vector does not exist"**
- Solution: Enable the pgvector extension in Supabase dashboard (Database > Extensions)

**Error: "permission denied for function gen_random_uuid"**
- Solution: The `gen_random_uuid()` function requires the `pgcrypto` extension:
  ```sql
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  ```

**Slow similarity search:**
- Increase IVFFlat lists parameter: `WITH (lists = 200)` for larger datasets
- Or switch to HNSW indexing (see above)
