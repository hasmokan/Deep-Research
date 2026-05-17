# Deep Research Agent Roadmap

**Goal:** Turn the current research workflow from "LLM + search + report" into a reliable deep research agent that can plan, gather evidence, compare sources, recover from failures, and support multi-turn refinement.

**Current baseline:**
- Dynamic research plan generation exists.
- Backend streams research progress and final results.
- Reports render in an artifact sidebar.
- Single-session multi-turn context is passed to the backend.
- Search, analysis, and report generation are still mostly linear.

---

## Core Agent Challenges

### 1. Dynamic Planning

The agent should not rely on a fixed plan template. It needs to infer the user's objective, constraints, likely source types, and expected output shape.

Key risks:
- Plans look specific but are not executable.
- The execution phase ignores the generated plan.
- Ambiguous prompts are researched too early without clarification.

Roadmap:
- Add a structured plan schema with subquestions, source strategy, output requirements, and clarification flags.
- Persist the selected plan in agent state.
- Make search and synthesis consume the plan explicitly.
- Add tests for vague, broad, and highly specific prompts.

### 2. Source Discovery And Ranking

Search results are noisy. The agent needs to rank, deduplicate, and filter sources before analysis.

Key risks:
- SEO pages dominate results.
- Multiple results repeat the same claim.
- Recent but low-quality sources override authoritative sources.
- The report cites weak evidence.

Roadmap:
- Normalize source metadata: title, URL, domain, date, source type.
- Add source deduplication by URL/domain/title similarity.
- Score sources by relevance, authority, freshness, and diversity.
- Keep rejected sources with reasons for debugging.

### 3. Evidence Extraction

The agent should extract claims and supporting evidence before writing the final report.

Key risks:
- The final report summarizes documents without traceable evidence.
- Claims are stated without source grounding.
- Contradictions are smoothed over instead of surfaced.

Roadmap:
- Add an evidence extraction node after source reading.
- Store evidence items with claim, quote or paraphrase, source URL, confidence, and limitations.
- Group evidence by subquestion.
- Require report sections to reference evidence groups.

### 4. Citation Grounding

Deep research quality depends on whether conclusions are traceable to sources.

Key risks:
- The model fabricates citations.
- Citations point to sources that do not support the claim.
- Generated reports cannot be audited.

Roadmap:
- Introduce a citation data model separate from markdown text.
- Generate reports from structured evidence plus citation IDs.
- Validate that every citation ID exists before returning the report.
- Add a post-generation citation check step.

### 5. Multi-Turn Context

Follow-up prompts such as "expand point three" or "turn that into a table" must resolve against prior reports and user messages.

Key risks:
- Follow-ups are treated as new standalone searches.
- Too much prior report text is stuffed into context.
- The agent loses which artifact the user is referring to.

Roadmap:
- Keep a thread state with messages, active plan, latest report, and artifacts.
- Summarize older turns into a compact conversation memory.
- Resolve follow-up intent before planning: refine, reformat, extend, compare, or restart.
- Add persistent `thread_id` support later for multi-session history.

### 6. Long Context Compression

Research runs produce more text than the model can reliably consume.

Key risks:
- Important evidence is dropped during summarization.
- Low-value source text crowds out high-value claims.
- Follow-up answers regress because prior context was compressed poorly.

Roadmap:
- Compress at source, evidence, and conversation levels separately.
- Preserve source references through every compression step.
- Track what was omitted and why.
- Prefer structured summaries over freeform summaries.

### 7. Agent State Machine

The workflow should be explicit enough to retry, branch, and inspect.

Target shape:

```text
clarify -> plan -> search -> rank -> read -> extract evidence -> compare -> synthesize -> validate -> report
```

Key risks:
- Failures collapse into a generic "Something went wrong".
- Intermediate state is hard to inspect.
- Nodes become tightly coupled and difficult to test.

Roadmap:
- Extend LangGraph state with plan, source candidates, ranked sources, evidence, citations, report, and errors.
- Make each node consume and produce typed state.
- Emit stream events at every major state transition.
- Add recovery paths for empty search, bad JSON, timeout, and partial evidence.

### 8. Failure Recovery

Production agent behavior needs graceful degradation.

Key risks:
- Search provider failure blocks the whole run.
- One bad model response invalidates the entire report.
- Users cannot tell which stage failed.

Roadmap:
- Add retries with bounded backoff around search and LLM calls.
- Add JSON repair or retry for structured outputs.
- Return partial results when report generation fails after evidence extraction.
- Surface stage-specific user-facing errors.

### 9. Evaluation

Deep research quality cannot be proven with only unit tests.

Key risks:
- The system works technically but produces weak research.
- Regressions are subjective and hard to detect.
- Prompt changes silently reduce source quality.

Roadmap:
- Create a golden set of research prompts across domains.
- Evaluate answer relevance, citation support, source quality, contradiction handling, and report structure.
- Use a mix of deterministic checks, human review, and LLM-as-judge.
- Track evaluation outputs over time before changing prompts or graph nodes.

---

## Phased Roadmap

### Phase 1: Make The Current Agent Inspectable

Purpose: expose what the agent is doing before making it smarter.

Deliverables:
- Typed research state for plan, sources, evidence, report, and errors.
- Stream events for each major node.
- Debug view or logs for source ranking and rejected sources.
- Tests for request history, stream events, and node state shape.

Success signal:
- A failed or low-quality report can be traced to a specific stage.

### Phase 2: Improve Source Quality

Purpose: prevent weak sources from polluting analysis.

Deliverables:
- Source normalization and deduplication.
- Source scoring model.
- Ranking explanations.
- Minimum source diversity rules.

Success signal:
- Reports cite fewer duplicate or low-authority sources, and source selection is explainable.

### Phase 3: Add Evidence Grounding

Purpose: make claims auditable.

Deliverables:
- Evidence extraction node.
- Structured evidence store in agent state.
- Citation ID generation and validation.
- Report generation based on evidence groups.

Success signal:
- Every important report claim can be traced to at least one evidence item.

### Phase 4: Strengthen Multi-Turn Research

Purpose: make follow-ups behave like continued research, not new unrelated runs.

Deliverables:
- Follow-up intent resolver.
- Conversation memory summary.
- Persistent thread/session state.
- Artifact-aware follow-up handling.

Success signal:
- Prompts like "expand the second section" and "compare it with the previous answer" resolve correctly.

### Phase 5: Build Evaluation Discipline

Purpose: make quality changes measurable.

Deliverables:
- Golden research prompt set.
- Automated quality checks for citations, source diversity, and report completeness.
- LLM-as-judge rubric for qualitative review.
- Regression report for prompt and graph changes.

Success signal:
- Agent quality can be compared before and after changes with repeatable evidence.

---

## Near-Term Implementation Priority

Recommended next sequence:

1. Add structured source metadata and ranking.
2. Add evidence extraction state.
3. Make report generation cite evidence IDs.
4. Add citation validation before returning a report.
5. Add persistent thread state after the single-session multi-turn flow stabilizes.

This order keeps the project focused on agent quality first. Multi-session persistence is useful, but it should not come before source quality and evidence grounding.
