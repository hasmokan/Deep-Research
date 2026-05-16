# Loading Thinking UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the loading skeleton with a ChatGPT-style thinking panel during research execution.

**Architecture:** Keep the current request/response API unchanged. Add a small frontend data helper for loading-stage messages, test it with Node's built-in test runner, then update `LoadingState` to render animated status lines instead of neutral skeleton bars.

**Tech Stack:** Next.js, React, Tailwind CSS, lucide-react, Node test runner.

---

### Task 1: Loading Thinking Data

**Files:**
- Create: `web/lib/research/loading-thinking.ts`
- Test: `web/lib/research/loading-thinking.test.ts`

**Step 1: Write the failing test**

Assert that the loading thinking data includes at least four sequential messages and exposes a valid active message for a given tick.

**Step 2: Run test to verify it fails**

Run: `node --test lib/research/loading-thinking.test.ts`

Expected: FAIL because `loading-thinking.ts` does not exist yet.

**Step 3: Write minimal implementation**

Export `loadingThinkingMessages` and `getLoadingThinkingMessage(index)`.

**Step 4: Run test to verify it passes**

Run: `node --test lib/research/loading-thinking.test.ts`

Expected: PASS.

### Task 2: Loading State UI

**Files:**
- Modify: `web/components/research/loading-state.tsx`

**Step 1: Replace skeleton preview**

Use the tested loading thinking messages to render a compact thinking panel with animated rows.

**Step 2: Verify frontend**

Run: `pnpm lint` and `pnpm build`.

Expected: both pass.

**Step 3: Capture screenshot**

Open the running frontend, trigger a request, and capture the loading stage.
