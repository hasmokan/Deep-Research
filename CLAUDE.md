# Deep Research Project

AI-powered deep research tool with intelligent search, knowledge extraction, and report generation.

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 16+ / shadcn/ui / Tailwind CSS / TypeScript |
| **Backend** | Python 3.11+ / FastAPI / LangGraph |
| **Database** | Supabase (pgvector) |

## Project Structure

```
deep-research/
├── web/                # Next.js frontend (see web/CLAUDE.md)
├── api/                # Python backend (see api/CLAUDE.md)
└── shared/             # Shared type definitions
```

## Development Guidelines Index

- **Frontend Guidelines**: [web/CLAUDE.md](./web/CLAUDE.md)
  - shadcn/ui component usage
  - Tailwind CSS styling conventions
  - Form handling (react-hook-form + zod)
  - State management (Zustand)
  - Performance optimization

- **Backend Guidelines**: [api/CLAUDE.md](./api/CLAUDE.md)
  - LangGraph Agent structure
  - Supabase vector operations
  - FastAPI route design
  - Async programming conventions

## Quick Start

```bash
# Frontend
cd web && pnpm install && pnpm dev

# Backend
cd api && pip install -r requirements.txt && uvicorn main:app --reload
```

## Environment Variables

```bash
# web/.env.local
NEXT_PUBLIC_API_URL=http://localhost:8000

# api/.env
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
OPENAI_API_KEY=
```

## Important Notes

- Never commit sensitive information (API keys) to the repository
- Use embedding dimension 1536 (OpenAI text-embedding-3-small)
- Frontend-backend communication uses JSON, dates in ISO 8601 format
