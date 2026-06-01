# S06 Context Compression Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add deterministic context compression for conversation history and ReAct tool observations.

**Architecture:** Create a small `agents.context_compression` helper module and wire it into existing context construction and ReAct fallback paths. Keep compression local, deterministic, and testable without extra LLM calls.

**Tech Stack:** Python 3.11, FastAPI backend, LangChain message objects, pytest.

---

### Task 1: Add Context Compression Unit Tests

**Files:**
- Create: `api/tests/test_context_compression.py`
- Modify: `api/tests/test_conversation_context.py`
- Modify: `api/tests/test_react_agent.py`

**Step 1: Write the failing tests**

Add tests for:

- `persist_large_output` returning a `<persisted-output>` marker and writing the full output to disk.
- `micro_compact_tool_messages` replacing older `ToolMessage` content with `[Earlier tool result omitted for brevity]`.
- `build_contextual_research_query` emitting a continuity summary for long histories.
- ReAct final synthesis receiving compacted older tool observations.

**Step 2: Run tests to verify they fail**

Run:

```bash
cd api
OPENAI_API_KEY=test OPENAI_BASE_URL=http://localhost:1 SUPABASE_URL=http://localhost:54321 SUPABASE_KEY=test SUPABASE_SERVICE_KEY=test .venv/bin/python -m pytest tests/test_context_compression.py tests/test_conversation_context.py tests/test_react_agent.py -q
```

Expected: FAIL because `agents.context_compression` and the new behavior do not exist yet.

### Task 2: Implement Compression Helpers

**Files:**
- Create: `api/agents/context_compression.py`

**Step 1: Add the minimal implementation**

Implement:

- `CompactState`
- `persist_large_output`
- `micro_compact_tool_messages`
- `compact_conversation_history`

Use deterministic string trimming and summaries. Do not introduce model calls.

**Step 2: Run helper tests**

Run:

```bash
cd api
OPENAI_API_KEY=test OPENAI_BASE_URL=http://localhost:1 SUPABASE_URL=http://localhost:54321 SUPABASE_KEY=test SUPABASE_SERVICE_KEY=test .venv/bin/python -m pytest tests/test_context_compression.py -q
```

Expected: PASS.

### Task 3: Wire Conversation History Compression

**Files:**
- Modify: `api/agents/conversation_context.py`
- Test: `api/tests/test_conversation_context.py`

**Step 1: Replace raw recent-history slicing**

Call `compact_conversation_history` after normalizing messages and after removing the duplicate current user request. Render the continuity summary before recent messages when compression happened.

**Step 2: Run conversation tests**

Run:

```bash
cd api
OPENAI_API_KEY=test OPENAI_BASE_URL=http://localhost:1 SUPABASE_URL=http://localhost:54321 SUPABASE_KEY=test SUPABASE_SERVICE_KEY=test .venv/bin/python -m pytest tests/test_conversation_context.py -q
```

Expected: PASS.

### Task 4: Wire ReAct Tool Micro-Compaction

**Files:**
- Modify: `api/agents/react_agent.py`
- Test: `api/tests/test_react_agent.py`

**Step 1: Compact fallback messages before synthesis and partial answer**

Use `micro_compact_tool_messages` only on the internal fallback message list. Keep streamed tool event payloads unchanged.

**Step 2: Run ReAct tests**

Run:

```bash
cd api
OPENAI_API_KEY=test OPENAI_BASE_URL=http://localhost:1 SUPABASE_URL=http://localhost:54321 SUPABASE_KEY=test SUPABASE_SERVICE_KEY=test .venv/bin/python -m pytest tests/test_react_agent.py -q
```

Expected: PASS.

### Task 5: Final Verification

**Files:**
- All files changed above.

**Step 1: Run the focused suite**

Run:

```bash
cd api
OPENAI_API_KEY=test OPENAI_BASE_URL=http://localhost:1 SUPABASE_URL=http://localhost:54321 SUPABASE_KEY=test SUPABASE_SERVICE_KEY=test .venv/bin/python -m pytest tests/test_context_compression.py tests/test_conversation_context.py tests/test_react_agent.py -q
```

Expected: PASS.

**Step 2: Review diff**

Run:

```bash
git diff -- docs/plans/2026-06-01-s06-context-compression-design.md docs/plans/2026-06-01-s06-context-compression-implementation-plan.md api/agents/context_compression.py api/agents/conversation_context.py api/agents/react_agent.py api/tests/test_context_compression.py api/tests/test_conversation_context.py api/tests/test_react_agent.py
```

Expected: Diff is scoped to the s06 documentation, compression helper, integrations, and tests.
