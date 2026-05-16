# SSE Research Stream Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stream research progress and thinking events from the backend to the loading UI.

**Architecture:** Add a FastAPI `text/event-stream` endpoint beside the existing blocking endpoint. The frontend opens an `EventSource`, updates loading-stage thinking messages as events arrive, and resolves the final `ResearchResult` when the server sends `complete`.

**Tech Stack:** FastAPI `StreamingResponse`, Server-Sent Events, Next.js, React, Zustand.

---

### Task 1: Backend SSE Contract

**Files:**
- Create: `api/agents/research_stream.py`
- Modify: `api/routers/research.py`
- Test: `api/tests/test_research_stream.py`

Write tests for SSE event formatting and `/api/research/stream` response headers/body.

### Task 2: Frontend Stream Client

**Files:**
- Modify: `web/lib/api/types.ts`
- Modify: `web/lib/api/client.ts`
- Modify: `web/lib/store/research.ts`

Add stream event types, an `streamResearch()` EventSource wrapper, and store actions for server-sent loading messages.

### Task 3: Loading UI Wiring

**Files:**
- Modify: `web/components/research/search-form.tsx`
- Modify: `web/components/research/loading-state.tsx`

Use the streaming client from the search form. Render server-sent thinking messages first, and use the animated local messages only before the first server event arrives.

### Task 4: Verification

Run backend tests, frontend loading helper test, lint, build, and browser screenshot.
