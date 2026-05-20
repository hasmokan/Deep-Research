import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildResearchActivity,
  buildResearchActivityStream,
  createResearchPlan,
  getRevealedPlanStepCount,
  getResearchQueryOverride,
  getResearchSubmitAction,
  normalizeResearchPlan,
  shouldRenderResearchPlanShell,
} from './research-workflow.ts';

test('createResearchPlan turns a query into a reviewable deep research plan', () => {
  const plan = createResearchPlan('Compare reasoning UI patterns for research tools');

  assert.equal(plan.query, 'Compare reasoning UI patterns for research tools');
  assert.equal(plan.sourceLabel, 'Public web');
  assert.equal(plan.steps.length, 4);
  assert.equal(plan.steps[0].title, 'Clarify the research objective');
  assert.ok(plan.steps.at(-1)?.detail.includes('report'));
});

test('getRevealedPlanStepCount reveals final plan steps one at a time', () => {
  assert.equal(getRevealedPlanStepCount(4, 0, 100, 250), 0);
  assert.equal(getRevealedPlanStepCount(4, 99, 100, 250), 0);
  assert.equal(getRevealedPlanStepCount(4, 100, 100, 250), 1);
  assert.equal(getRevealedPlanStepCount(4, 349, 100, 250), 1);
  assert.equal(getRevealedPlanStepCount(4, 350, 100, 250), 2);
  assert.equal(getRevealedPlanStepCount(4, 850, 100, 250), 4);
  assert.equal(getRevealedPlanStepCount(4, 2000, 100, 250), 4);
});

test('shouldRenderResearchPlanShell keeps the plan panel visible while waiting for model output', () => {
  assert.equal(shouldRenderResearchPlanShell({ isPlanning: true, hasPlan: false }), true);
  assert.equal(shouldRenderResearchPlanShell({ isPlanning: false, hasPlan: true }), true);
  assert.equal(shouldRenderResearchPlanShell({ isPlanning: false, hasPlan: false }), false);
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

test('buildResearchActivity summarizes report draft thinking instead of exposing the full report body', () => {
  const reportDraft = [
    '# 研究报告：夏日弥身份分析',
    '',
    '## Executive Summary',
    '',
    '这是一段很长的报告正文，不应该塞进主对话流。',
  ].join('\n');

  const activity = buildResearchActivity(
    [],
    [
      {
        id: 'report-draft',
        stage: 'report',
        label: 'Report draft',
        text: reportDraft,
      },
    ],
  );

  assert.equal(activity[0].kind, 'thinking');
  assert.equal(activity[0].title, 'Report draft');
  assert.match(activity[0].detail, /Structuring section: Executive Summary/);
  assert.match(activity[0].detail, /Full report opens in the artifact panel/);
  assert.doesNotMatch(activity[0].detail, /这是一段很长的报告正文/);
});

test('buildResearchActivity summarizes report draft trace events instead of exposing the full report body', () => {
  const reportDraft = '# 研究报告\n\n## Executive Summary\n\n完整正文不应该进入对话区。';
  const activity = buildResearchActivity(
    [],
    [],
    [],
    [
      {
        id: 'draft-report',
        stage: 'report',
        kind: 'reasoning',
        title: 'Report draft',
        detail: reportDraft,
      },
    ],
  );

  assert.equal(activity[0].title, 'Report draft');
  assert.match(activity[0].detail, /Structuring section: Executive Summary/);
  assert.match(activity[0].detail, /Full report opens in the artifact panel/);
  assert.doesNotMatch(activity[0].detail, /完整正文/);
});

test('buildResearchActivity summarizes analysis draft trace events instead of exposing markdown bodies', () => {
  const analysisDraft = [
    '# hasmokan 身份分析',
    '',
    '## 基本信息',
    '',
    '| 项目 | 内容 |',
    '|------|------|',
    '| **身份** | GitHub 开发者/用户名 |',
    '',
    '## 主要项目与技术栈',
    '',
    '这类草稿正文不应该塞进主对话流。',
  ].join('\n');

  const activity = buildResearchActivity(
    [],
    [],
    [],
    [
      {
        id: 'analysis-draft',
        stage: 'analyze',
        kind: 'reasoning',
        title: 'Analysis draft',
        detail: analysisDraft,
      },
    ],
  );

  assert.equal(activity[0].title, 'Analysis draft');
  assert.match(activity[0].detail, /Structuring section: 基本信息/);
  assert.match(activity[0].detail, /Structuring section: 主要项目与技术栈/);
  assert.doesNotMatch(activity[0].detail, /GitHub 开发者/);
});

test('buildResearchActivity preserves streamed thinking ids for animated updates', () => {
  const activity = buildResearchActivity(
    [],
    [
      {
        id: 'analysis-thinking-stream',
        stage: 'analyze',
        label: 'Thinking',
        text: 'Comparing source quality before drafting.',
      },
    ],
    [],
    [
      {
        id: 'read-sources',
        stage: 'analyze',
        kind: 'reasoning',
        title: 'Read sources',
        detail: 'Reading the strongest matches.',
      },
    ],
  );

  assert.equal(activity[1].id, 'analysis-thinking-stream');
  assert.equal(activity[1].kind, 'thinking');
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
