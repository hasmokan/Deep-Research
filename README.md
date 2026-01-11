# Deep Research

AI-powered deep research tool with intelligent search, document analysis, and automated report generation.

## Features

- 🔍 **Semantic Search**: Vector-based similarity search using OpenAI embeddings
- 🤖 **AI Analysis**: Intelligent document analysis powered by LangGraph
- 📊 **Report Generation**: Automated research report creation using GPT-4
- 💾 **Vector Database**: Efficient storage and retrieval with Supabase pgvector
- 🎨 **Modern UI**: Beautiful interface built with Next.js and shadcn/ui

## Tech Stack

### Frontend
- **Next.js 16+** (App Router)
- **TypeScript** (Strict mode)
- **Tailwind CSS** (v4)
- **shadcn/ui** (Radix UI components)
- **Zustand** (State management)

### Backend
- **Python 3.11+**
- **FastAPI** (Web framework)
- **LangGraph** (AI agent orchestration)
- **LangChain** (LLM framework)
- **OpenAI API** (Embeddings & LLM)

### Database
- **Supabase** (PostgreSQL + pgvector)

## Project Structure

```
deep-research/
├── web/                    # Next.js frontend
│   ├── app/               # App Router pages
│   ├── components/        # React components
│   │   ├── ui/           # shadcn/ui base components
│   │   └── research/     # Research feature components
│   └── lib/              # Utilities and API client
│       ├── api/          # Backend API client
│       └── store/        # Zustand state management
├── api/                    # Python backend
│   ├── main.py            # FastAPI application entry
│   ├── agents/            # LangGraph agents
│   │   ├── research_agent.py
│   │   └── nodes/        # Agent nodes
│   ├── services/          # Business logic
│   │   └── vector_store.py
│   ├── routers/           # FastAPI routes
│   ├── models/            # Pydantic models
│   ├── core/              # Configuration
│   └── database/          # SQL schemas
└── CLAUDE.md              # Project guidelines
```

## Prerequisites

- **Node.js** 18+ (with pnpm)
- **Python** 3.11+
- **Supabase** account
- **OpenAI** API key

## Setup Instructions

### 1. Clone Repository

```bash
git clone <repository-url>
cd deep-research
```

### 2. Database Setup

1. Create a Supabase project at [https://supabase.com](https://supabase.com)
2. Go to SQL Editor in your Supabase dashboard
3. Execute the schema in `api/database/schema.sql`
4. Enable pgvector extension in Database > Extensions

For detailed instructions, see [api/database/README.md](api/database/README.md)

### 3. Backend Setup

```bash
cd api

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env and add your credentials:
# - SUPABASE_URL
# - SUPABASE_SERVICE_KEY
# - OPENAI_API_KEY
```

### 4. Frontend Setup

```bash
cd web

# Install dependencies
pnpm install

# Configure environment
# Create .env.local (already exists with default values)
# Edit if your backend runs on a different port
```

## Running the Application

### Start Backend

```bash
cd api
source venv/bin/activate  # On Windows: venv\Scripts\activate
uvicorn main:app --reload --port 8000
```

The API will be available at: http://localhost:8000

API Documentation: http://localhost:8000/docs

### Start Frontend

```bash
cd web
pnpm dev
```

The web app will be available at: http://localhost:3000

## Usage

### Adding Documents

Before running research queries, you need to add documents to the vector database:

```bash
# Using the API directly
curl -X POST http://localhost:8000/api/research/documents \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Your document content here",
    "metadata": {"source": "example", "date": "2024-01-10"}
  }'
```

Or create a script to bulk import documents.

### Running Research

1. Open http://localhost:3000
2. Enter your research query in the search box
3. Click "Search" to start the research process
4. Wait for the AI agent to:
   - Search relevant documents
   - Analyze the content
   - Generate a comprehensive report

## API Endpoints

### Research

- `POST /api/research/` - Create research query (returns basic info)
- `POST /api/research/execute` - Execute research and get full results
- `GET /api/research/documents` - List all documents
- `POST /api/research/documents` - Add a new document
- `DELETE /api/research/documents/{id}` - Delete a document

### Health Check

- `GET /health` - API health check

## LangGraph Agent Flow

The research agent follows this workflow:

```
┌─────────┐
│ Search  │ - Vector similarity search in Supabase
└────┬────┘
     │
     ▼
┌─────────┐
│ Analyze │ - Extract insights using GPT-4o-mini
└────┬────┘
     │
     ▼
┌──────────┐
│ Generate │ - Create comprehensive report with GPT-4o
└──────────┘
```

Each node is conditionally executed based on the state:
- If no documents found → Skip analysis
- If analysis fails → Skip report generation

## Development

### Type Checking

```bash
# Frontend
cd web && pnpm type-check

# Backend
cd api && mypy api/
```

### Linting

```bash
# Frontend
cd web && pnpm lint

# Backend
cd api && ruff check api/
```

### Code Formatting

```bash
# Frontend
cd web && pnpm format

# Backend
cd api && ruff format api/
```

## Configuration

### Vector Search Parameters

Edit `api/services/vector_store.py`:

```python
# Adjust similarity threshold (0-1)
threshold = 0.7  # Higher = stricter matching

# Adjust result limit
limit = 10  # Maximum documents to retrieve
```

### LLM Models

Edit `api/agents/nodes/`:

- **analyze.py**: Uses `gpt-4o-mini` (fast, cost-effective)
- **generate.py**: Uses `gpt-4o` (high quality reports)

Change models in the respective files if needed.

## Troubleshooting

### Backend Issues

**Error: "Module not found"**
```bash
# Ensure you're in the api directory and venv is activated
cd api
source venv/bin/activate
pip install -r requirements.txt
```

**Error: "Supabase connection failed"**
- Check `.env` file has correct `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`
- Verify Supabase project is active

**Error: "OpenAI API key invalid"**
- Check `.env` file has valid `OPENAI_API_KEY`
- Ensure you have sufficient credits

### Frontend Issues

**Error: "Cannot connect to backend"**
- Ensure backend is running on port 8000
- Check `NEXT_PUBLIC_API_URL` in `.env.local`

**Error: "Module not found"**
```bash
cd web
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

## License

MIT

## Contributing

Contributions are welcome! Please read the development guidelines in [CLAUDE.md](CLAUDE.md) before submitting PRs.
