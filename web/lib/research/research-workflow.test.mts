import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildResearchActivity,
  buildResearchActivityStream,
  createResearchPlan,
  getResearchQueryOverride,
  getResearchSubmitAction,
  normalizeResearchPlan,
} from './research-workflow.ts';

test('createResearchPlan turns a query into a reviewable deep research plan', () => {
  const plan = createResearchPlan('Compare reasoning UI patterns for research tools');

  assert.equal(plan.query, 'Compare reasoning UI patterns for research tools');
  assert.equal(plan.sourceLabel, 'Public web');
  assert.equal(plan.steps.length, 4);
  assert.equal(plan.steps[0].title, 'Clarify the research objective');
  assert.ok(plan.steps.at(-1)?.detail.includes('report'));
});

test('buildResearchActivity creates a readable activity history from stream events', () => {
  const activity = buildResearchActivity(
    [
      {
        stage: 'search',
        label: 'Searching',
        message: 'Searching the web for useful sources and context.',
      },
      {
        stage: 'analyze',
        label: 'Analyzing',
        message: 'Comparing source claims and extracting evidence.',
      },
    ],
    [
      {
        stage: 'analyze',
        label: 'Reading',
        text: 'Checking source quality before drafting conclusions.',
      },
    ],
    [
      {
        id: 1,
        content: '**Source A**\n\nUseful evidence.',
        metadata: {
          title: 'Source A',
          url: 'https://example.com/a',
        },
        similarity: 1,
      },
    ],
  );

  assert.deepEqual(
    activity.map((event) => event.title),
    ['Searching', 'Sources found', 'Analyzing', 'Reading'],
  );
  assert.equal(activity[0].kind, 'status');
  assert.equal(activity[1].kind, 'sources');
  const sourceDocument = activity[1].documents?.[0];
  assert.ok(sourceDocument && 'metadata' in sourceDocument);
  assert.equal(sourceDocument.metadata.title, 'Source A');
  assert.equal(activity[3].kind, 'thinking');
});

test('buildResearchActivity keeps backend trace and model thinking events', () => {
  const activity = buildResearchActivity(
    [
      {
        stage: 'search',
        label: 'Searching',
        message: 'Searching the web.',
      },
    ],
    [
      {
        stage: 'analyze',
        label: 'Analysis thinking',
        text: 'I should compare source reliability before drafting the report.',
      },
    ],
    [],
    [
      {
        id: 'search-tool-call',
        stage: 'search',
        kind: 'tool_call',
        title: 'Search web',
        detail: 'Searching public web sources for: 测试',
        tool: 'web_search',
      },
      {
        id: 'search-tool-result',
        stage: 'search',
        kind: 'tool_result',
        title: 'Sources found',
        detail: 'Found 1 source candidates.',
        documents: [
          {
            id: 'web_0',
            title: '真实来源',
            url: 'https://example.com/source',
            source: 'example.com',
          },
        ],
      },
    ],
  );

  assert.deepEqual(
    activity.map((event) => event.title),
    ['Search web', 'Sources found', 'Analysis thinking'],
  );
  assert.equal(activity[0].kind, 'tool_call');
  const traceDocument = activity[1].documents?.[0];
  assert.ok(traceDocument && 'title' in traceDocument);
  assert.equal(traceDocument.title, '真实来源');
  assert.equal(activity[2].kind, 'thinking');
  assert.match(activity[2].detail, /compare source reliability/);
});

test('buildResearchActivityStream collapses older agent steps like a message stream', () => {
  const activity = buildResearchActivity(
    [],
    [],
    [],
    [
      {
        id: 'search-call',
        stage: 'search',
        kind: 'tool_call',
        title: 'Search web',
        detail: 'Searching public web sources.',
      },
      {
        id: 'search-result',
        stage: 'search',
        kind: 'tool_result',
        title: 'Sources found',
        detail: 'Found 15 sources.',
      },
      {
        id: 'read',
        stage: 'analyze',
        kind: 'reasoning',
        title: 'Read sources',
        detail: 'Comparing evidence.',
      },
      {
        id: 'draft',
        stage: 'report',
        kind: 'reasoning',
        title: 'Draft report',
        detail: 'Writing the report.',
      },
    ],
  );

  const collapsed = buildResearchActivityStream(activity, false);
  const expanded = buildResearchActivityStream(activity, true);

  assert.equal(collapsed.hiddenCount, 2);
  assert.equal(collapsed.toggleLabel, 'More steps');
  assert.deepEqual(
    collapsed.visibleEvents.map((event) => event.id),
    ['read', 'draft'],
  );
  assert.equal(expanded.hiddenCount, 2);
  assert.equal(expanded.toggleLabel, 'Less steps');
  assert.equal(expanded.visibleEvents.length, 4);
});

test('normalizeResearchPlan maps backend generated plan fields into UI fields', () => {
  const plan = normalizeResearchPlan({
    query: 'Compare AI search products',
    source_label: 'Public web',
    summary: 'Compare AI search products by source coverage, UX, and report quality.',
    should_plan: true,
    steps: [
      {
        id: 'scope',
        title: 'Define comparison criteria',
        detail: 'Clarify products, dimensions, and evidence needs.',
      },
      {
        id: 'sources',
        title: 'Collect product and review sources',
        detail: 'Use official pages, documentation, reviews, and recent benchmarks.',
      },
    ],
  });

  assert.equal(plan.query, 'Compare AI search products');
  assert.equal(plan.sourceLabel, 'Public web');
  assert.equal(plan.summary, 'Compare AI search products by source coverage, UX, and report quality.');
  assert.deepEqual(
    plan.steps.map((step) => step.title),
    ['Define comparison criteria', 'Collect product and review sources'],
  );
});

test('getResearchSubmitAction sends simple follow-ups directly unless deep research mode is on', () => {
  assert.equal(
    getResearchSubmitAction({
      query: '来源是？',
      hasPlan: false,
      canSendFollowUp: true,
      isDeepResearchMode: false,
    }),
    'start-research',
  );

  assert.equal(
    getResearchSubmitAction({
      query: '重新做一个竞品调研',
      hasPlan: false,
      canSendFollowUp: true,
      isDeepResearchMode: true,
    }),
    'create-plan',
  );
});

test('getResearchSubmitAction starts an existing plan when no new query is typed', () => {
  assert.equal(
    getResearchSubmitAction({
      query: '',
      hasPlan: true,
      canSendFollowUp: false,
      isDeepResearchMode: true,
    }),
    'start-research',
  );
});

test('getResearchQueryOverride ignores non-string callback arguments', () => {
  assert.equal(getResearchQueryOverride(' 来源是？ '), '来源是？');
  assert.equal(getResearchQueryOverride({ type: 'click' }), '');
  assert.equal(getResearchQueryOverride(undefined), '');
});
