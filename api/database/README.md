# Database Setup Guide

## Prerequisites

1. Create a Supabase project at [https://supabase.com](https://supabase.com)
2. Get your project URL and service key from Settings > API

## Setup Steps

### 1. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env`:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key
OPENAI_API_KEY=your-openai-api-key
FRONTEND_URL=http://localhost:3000
```

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

### 3. Verify Setup

After running the schema, you should have:

**Tables:**
- `documents` - Stores document content with vector embeddings
- `research_sessions` - Tracks research queries and results

**Indexes:**
- `documents_embedding_idx` - IVFFlat index for fast vector similarity search
- `documents_metadata_idx` - GIN index for metadata queries
- `documents_created_at_idx` - Index for time-based queries

**Functions:**
- `match_documents()` - Performs similarity search with threshold
- `update_updated_at_column()` - Automatically updates timestamps

### 4. Test Connection

Run the FastAPI server:
```bash
cd api
pip install -r requirements.txt
uvicorn main:app --reload
```

Visit: http://localhost:8000/health

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

Current setup uses **1536 dimensions** (OpenAI `text-embedding-3-small`).

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
