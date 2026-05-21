# DeerFlow Agent Trace Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the fixed linear agent trace with a DeerFlow-style execution graph that reflects routing, tool calls, observations, thinking, sources, and output generation.

**Architecture:** Keep the current SSE transport and persisted run events. Add a frontend graph projection over existing `status`, `trace`, `thinking`, and `agent_message` events, then enrich backend events where the stream currently hides decisions such as selected route. Render a compact node graph in `LoadingState` with active/completed/error states instead of a plain list.

**Tech Stack:** FastAPI SSE, Next.js, React, TypeScript, Tailwind CSS, lucide-react, Node test runner, pytest/unittest.

---

### Task 1: Frontend Graph Projection

**Files:**
- Modify: `web/lib/api/types.ts`
- Modify: `web/lib/research/conversation.ts`
- Modify: `web/lib/research/research-workflow.ts`
- Test: `web/lib/research/research-workflow.test.mts`

**Steps:**
1. Write failing tests for `buildResearchExecutionGraph()` using mixed status, trace, thinking, and ReAct agent messages.
2. Run `node --test lib/research/research-workflow.test.mts` from `web` and verify the new tests fail.
3. Add graph node and edge types, include the `react` stage in stream types, and project activity events into node cards.
4. Re-run the test and keep existing activity tests green.

### Task 2: DeerFlow-Style Trace UI

**Files:**
- Modify: `web/components/research/loading-state.tsx`

**Steps:**
1. Replace the fixed timeline-first layout with an execution graph header, node grid, and event details drawer.
2. Keep source pills and thinking summaries visible inside relevant nodes.
3. Preserve saved/completed/stopped states for restored sessions.
4. Run lint/build after the data layer is green.

### Task 3: Backend Trace Enrichment

**Files:**
- Modify: `api/agents/research_stream.py`
- Test: `api/tests/test_research_stream.py`
- Test: `api/tests/test_agent_follow_up_routing.py`

**Steps:**
1. Write failing tests that expect a route decision trace and a ReAct start trace.
2. Emit structured `reasoning` trace events for route selection and ReAct execution start.
3. Keep existing status events for backward compatibility.
4. Run focused backend tests.

### Task 4: Verification

**Commands:**
- `cd web && node --test lib/research/research-workflow.test.mts lib/research/conversation.test.mts`
- `cd web && pnpm lint`
- `cd web && pnpm build`
- `cd api && pytest tests/test_research_stream.py tests/test_agent_follow_up_routing.py`

