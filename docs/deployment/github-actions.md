# GitHub Actions Deployment

The repository deploys to `https://hasmodream.com/ds` through `.github/workflows/deploy.yml`.

## Required GitHub Secrets

Set these in GitHub:

`Settings` -> `Secrets and variables` -> `Actions` -> `New repository secret`

```text
GOMAMI_SSH_PRIVATE_KEY=<private key contents>
```

The workflow uses the fixed target `root@103.112.1.107:22`. The private key for
`GOMAMI_SSH_PRIVATE_KEY` is the gomami deploy key.

Only paste the private key into GitHub Secrets. Do not commit it.

## Required GitHub Variables

Set these in:

`Settings` -> `Secrets and variables` -> `Actions` -> `Variables`

```text
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<supabase publishable key>
```

These are browser-visible build variables. Do not put the Supabase service role
key in `NEXT_PUBLIC_*`.

## Server Layout

The target server must already have Docker Engine with Docker Compose available
as either `docker-compose` or `docker compose`.

The workflow deploys to the existing server layout:

```text
/ds   Next.js frontend and docker-compose.yml
/api  FastAPI backend and backend .env
```

The script preserves server-owned environment files:

```text
/ds/.env
/api/.env
```

Create `/api/.env` on the server before the first deploy. It must contain the
real backend secrets:

```text
OPENAI_API_KEY=<model provider api key>
OPENAI_BASE_URL=<openai-compatible base url>
LLM_MODEL=<model name>
EMBEDDING_MODEL=openai/text-embedding-3-small
FRONTEND_URL=https://hasmodream.com
RESEARCH_STORAGE_BACKEND=json
LANGGRAPH_CHECKPOINT_BACKEND=memory
RESEARCH_QUEUE_BACKEND=redis
REDIS_URL=redis://redis:6379/0
```

If persistent Supabase storage is enabled, add:

```text
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=<supabase publishable key>
SUPABASE_SERVICE_KEY=<supabase service role key>
RESEARCH_STORAGE_BACKEND=supabase
```

## Trigger

The workflow runs on every push to `main` and can also be started manually from the GitHub Actions tab.

## Verification

The workflow checks:

```text
https://hasmodream.com/ds
https://hasmodream.com/ds/health
```
