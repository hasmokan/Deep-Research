# Docker Compose Deployment

This project can run the API and web app as separate Docker Compose services.

## Local Setup

The API reads server-side secrets from `api/.env`.

The root `.env` file is used by Docker Compose for ports, CORS, and Next.js build-time public variables. It is intentionally ignored by git.

Create or update the root `.env`:

```bash
cp .env.deploy.example .env
```

For local development, use:

```env
API_PORT=8000
WEB_PORT=3000
NEXT_PUBLIC_API_URL=http://localhost:8000
FRONTEND_URL=http://localhost:3000
NEXT_PUBLIC_AUTH_CALLBACK_PATH=/auth/callback
RESEARCH_STORAGE_BACKEND=json
```

Set these from `web/.env.local` or your Supabase project settings:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Start Docker, then run:

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f --tail=100 api web
```

Local URLs:

- Web: `http://localhost:3000`
- API: `http://localhost:8000`
- API health: `http://localhost:8000/health`

## Server Setup

On the server, keep secrets out of git:

1. Copy the repository to the host.
2. Create `api/.env` with backend secrets.
3. Create root `.env` from `.env.deploy.example`.
4. Set `NEXT_PUBLIC_API_URL` and `FRONTEND_URL` to the public host/domain.
5. Run `docker compose up --build -d`.

If the public URL changes, rebuild the `web` service because `NEXT_PUBLIC_*` values are compiled into the Next.js bundle:

```bash
docker compose build web
docker compose up -d web
```

## Sandbox Direction

The Compose layout gives us control over future sandbox services. The current app runs `api` and `web`; a later Docker sandbox can be added as a separate service or worker without changing the frontend deployment model.
