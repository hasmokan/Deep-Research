# Inline Chat Error and Plan Fallback Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the oversized global error card with an inline chat error state and prevent malformed plan-assessment JSON from failing the whole chat.

**Architecture:** Plan-assessment parse failures are treated as a recoverable classifier failure: log the malformed model output and continue with `should_plan=false`. Frontend errors render as compact assistant-style inline messages with clear actions instead of page-like alert panels.

**Tech Stack:** FastAPI/Python backend, Next.js/React frontend, node:test source checks, pytest/unittest backend tests.

---

### Task 1: Backend Plan Assessment Fallback

**Files:**
- Modify: `api/agents/nodes/plan.py`
- Test: `api/tests/test_research_plan.py`

**Steps:**
1. Add a failing test where `assess_research_plan_need()` receives non-JSON model content and returns `{"should_plan": False, ...}`.
2. Run the focused backend test and confirm it fails on `ValueError`.
3. Add logging and a narrow fallback around plan-need JSON parsing only.
4. Re-run the focused backend tests.

### Task 2: Inline Chat Error State

**Files:**
- Modify: `web/components/research/error-state.tsx`
- Test: `web/app/page.test.mts`

**Steps:**
1. Add a failing source-level test that rejects the old full-card copy and requires inline retry/direct-answer affordances.
2. Run the focused frontend test and confirm it fails.
3. Redesign `ErrorState` as a compact assistant inline status with retry, direct-answer, and details affordances.
4. Re-run the focused frontend tests.

### Task 3: Verification

**Commands:**
- `cd api && pytest tests/test_research_plan.py`
- `cd web && pnpm exec tsx --test app/page.test.mts lib/research/chat-shell.test.mts`
- `cd web && pnpm lint`
- Start the dev server and inspect the mobile-sized UI in Browser.
