import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildResearchActivity,
  createResearchPlan,
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
  );

  assert.deepEqual(
    activity.map((event) => event.title),
    ['Searching', 'Analyzing', 'Reading'],
  );
  assert.equal(activity[0].kind, 'status');
  assert.equal(activity[2].kind, 'thinking');
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
