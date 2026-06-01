# S06 Context Compression Design

## Goal

Implement the s06 context compression lesson in Deep Research as a small, testable backend feature: keep long conversations and tool observations useful without letting raw history dominate the active model context.

## Scope

This change covers two active-context surfaces that already exist in the codebase:

- `agents.conversation_context.build_contextual_research_query`, which turns multi-turn chat history into the current research prompt.
- `agents.react_agent` fallback and final-synthesis message history, which carries ReAct tool observations between model calls.

It does not add long-term memory behavior. Memory remains owned by `services.research_memories`; compression only controls what stays in the current active prompt.

## Approach

Use the three-layer teaching model from s06:

1. Large content is represented with a short preview and an explicit persisted-output marker.
2. Older tool results are micro-compacted to a placeholder, while the most recent observations remain intact.
3. If the whole conversation context is still too large, it becomes a continuity summary that preserves goal, touched files/signals, decisions, and next-step context.

The implementation should be conservative and deterministic. It should not call another model to summarize; tests need stable output, and the current product already has LLM stages elsewhere.

## Components

Add a small compression helper module:

- `CompactState`: tracks `has_compacted`, `last_summary`, and `recent_files`.
- `persist_large_output`: converts oversized content into a `<persisted-output>` marker with a preview.
- `micro_compact_tool_messages`: replaces older `ToolMessage` content with a placeholder.
- `compact_conversation_history`: normalizes chat history, keeps recent messages, and emits a deterministic continuity summary when history exceeds the active context budget.

Wire it into existing code:

- `conversation_context.py` should call the compacting helper before rendering previous conversation context.
- `react_agent.py` should compact fallback tool observations before final synthesis and partial fallback rendering.

## Data Flow

For regular short follow-ups, behavior stays unchanged: recent user and assistant messages render as they do today.

For long histories, `build_contextual_research_query` should emit:

- A fixed intro telling the model how to use history.
- A `Context continuity summary` section when compression happened.
- Recent uncompressed messages after the summary, if available.
- The authoritative current user request.

For ReAct fallback, tool results should be compacted only in the internal model message list. Streamed tool events still show the actual tool result content returned during the run.

## Error Handling

Compression must be best-effort and local:

- Invalid or unknown message roles continue to be ignored.
- Empty content remains excluded.
- If a file cannot be persisted, the helper should fall back to an inline preview marker rather than failing the research run.

The initial implementation can persist to `.task_outputs/tool-results` for explicit helper calls, but ReAct streaming should default to in-memory markers to avoid unnecessary disk writes for normal web search snippets.

## Testing

Add focused tests before implementation:

- Long conversation history produces a continuity summary and does not include early raw oversized messages.
- Short conversation history remains compatible with existing assertions.
- Large tool output produces a persisted-output marker with a path and preview.
- ReAct final synthesis receives compacted older tool observations while keeping the latest observations intact.

Run:

```bash
OPENAI_API_KEY=test OPENAI_BASE_URL=http://localhost:1 SUPABASE_URL=http://localhost:54321 SUPABASE_KEY=test SUPABASE_SERVICE_KEY=test .venv/bin/python -m pytest tests/test_context_compression.py tests/test_conversation_context.py tests/test_react_agent.py -q
```
