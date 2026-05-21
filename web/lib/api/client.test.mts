import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiClient } from './client.ts';
import type {
  AgentMessage,
  ResearchPlanResponse,
  ResearchPlanStreamStatus,
  ResearchResult,
  ResearchStreamStatus,
} from './types';

test('streamResearchPlan reads status events and returns the completed plan', async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  const statuses: ResearchPlanStreamStatus[] = [];
  const streamedPlans: ResearchPlanResponse[] = [];

  const plan: ResearchPlanResponse = {
    query: 'Compare AI search products',
    source_label: 'Public web',
    summary: 'Compare AI search products by source coverage, UX, and report quality.',
    steps: [
      {
        id: 'scope',
        title: 'Define comparison criteria',
        detail: 'Clarify products, dimensions, and the evidence needed for a useful comparison.',
      },
    ],
    should_plan: true,
  };

  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'http://api.test/api/research/plan/stream');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.body, JSON.stringify({ query: plan.query }));

    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('event: status\ndata: {"stage":"plan","label":"Planning","message":"Clarifying scope."}\n\n'));
        controller.enqueue(encoder.encode(`event: plan\ndata: ${JSON.stringify(plan)}\n\n`));
        controller.enqueue(encoder.encode(`event: complete\ndata: ${JSON.stringify(plan)}\n\n`));
        controller.close();
      },
    });

    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };

  try {
    const client = new ApiClient('http://api.test');
    const result = await client.streamResearchPlan(
      { query: plan.query },
      {
        onStatus: (status) => statuses.push(status),
        onPlan: (nextPlan) => streamedPlans.push(nextPlan),
      },
    );

    assert.deepEqual(statuses, [
      { stage: 'plan', label: 'Planning', message: 'Clarifying scope.' },
    ]);
    assert.deepEqual(streamedPlans, [plan]);
    assert.deepEqual(result, plan);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('request methods send the current bearer token', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'http://api.test/api/research/threads');
    assert.equal(init?.headers && new Headers(init.headers).get('Authorization'), 'Bearer token-123');

    return Response.json([]);
  };

  try {
    const client = new ApiClient('http://api.test');
    client.setAccessTokenProvider(() => 'token-123');

    await client.listResearchThreads();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('stream methods send the current bearer token', async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();

  const plan: ResearchPlanResponse = {
    query: 'Compare AI search products',
    source_label: 'Public web',
    summary: 'Compare AI search products by source coverage, UX, and report quality.',
    steps: [],
    should_plan: true,
  };

  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'http://api.test/api/research/plan/stream');
    assert.equal(init?.headers && new Headers(init.headers).get('Authorization'), 'Bearer token-123');

    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`event: complete\ndata: ${JSON.stringify(plan)}\n\n`));
        controller.close();
      },
    });

    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };

  try {
    const client = new ApiClient('http://api.test');
    client.setAccessTokenProvider(() => 'token-123');

    await client.streamResearchPlan({ query: plan.query });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamResearchRun reconnects to a persisted run event stream', async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  const statuses: ResearchStreamStatus[] = [];
  const result: ResearchResult = {
    query: 'test query',
    documents: [],
    analysis: null,
    report: '# Report',
    result_type: 'report',
    status: 'completed',
  };

  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'http://api.test/api/research/runs/run-123/stream?after_seq=4');
    assert.equal(init?.method, 'GET');
    assert.equal(init?.headers && new Headers(init.headers).get('Authorization'), 'Bearer token-123');

    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('event: status\ndata: {"stage":"search","label":"Searching","message":"Searching web."}\n\n'));
        controller.enqueue(encoder.encode(`event: complete\ndata: ${JSON.stringify(result)}\n\n`));
        controller.close();
      },
    });

    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };

  try {
    const client = new ApiClient('http://api.test');
    client.setAccessTokenProvider(() => 'token-123');

    const restoredResult = await client.streamResearchRun('run-123', {
      afterSeq: 4,
      onStatus: (status) => statuses.push(status),
    });

    assert.deepEqual(statuses, [
      { stage: 'search', label: 'Searching', message: 'Searching web.' },
    ]);
    assert.deepEqual(restoredResult, result);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamResearch forwards ReAct agent messages', async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  const agentMessages: AgentMessage[] = [];
  const result: ResearchResult = {
    query: '谁是 hasmokan',
    documents: [],
    analysis: null,
    report: null,
    answer: 'hasmokan appears to be a GitHub user.',
    result_type: 'answer',
    status: 'completed',
  };

  const aiMessage: AgentMessage = {
    type: 'ai',
    id: 'ai-1',
    content: '',
    reasoning_content: 'Need public evidence before answering.',
    tool_calls: [
      {
        id: 'call-1',
        name: 'web_search',
        args: { query: 'hasmokan GitHub' },
      },
    ],
  };
  const toolMessage: AgentMessage = {
    type: 'tool',
    id: 'tool-call-1',
    tool_call_id: 'call-1',
    name: 'web_search',
    content: '[{"title":"hasmokan - GitHub","url":"https://github.com/hasmokan"}]',
  };

  globalThis.fetch = async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`event: agent_message\ndata: ${JSON.stringify(aiMessage)}\n\n`));
        controller.enqueue(encoder.encode(`event: agent_message\ndata: ${JSON.stringify(toolMessage)}\n\n`));
        controller.enqueue(encoder.encode(`event: complete\ndata: ${JSON.stringify(result)}\n\n`));
        controller.close();
      },
    });

    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };

  try {
    const client = new ApiClient('http://api.test');
    const streamedResult = await client.streamResearch(
      { query: '谁是 hasmokan' },
      { onAgentMessage: (message) => agentMessages.push(message) },
    );

    assert.deepEqual(agentMessages, [aiMessage, toolMessage]);
    assert.deepEqual(streamedResult, result);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamResearch forwards answer deltas while preserving final result', async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  const deltas: string[] = [];
  const result: ResearchResult = {
    query: '帮我写一段力扣代码',
    documents: [],
    analysis: null,
    report: null,
    answer: '```python\nprint("ok")\n```',
    result_type: 'answer',
    status: 'completed',
  };

  globalThis.fetch = async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('event: answer_delta\ndata: {"delta":"```python\\n"}\n\n'));
        controller.enqueue(encoder.encode('event: answer_delta\ndata: {"delta":"print(\\"ok\\")\\n```"}\n\n'));
        controller.enqueue(encoder.encode(`event: complete\ndata: ${JSON.stringify(result)}\n\n`));
        controller.close();
      },
    });

    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };

  try {
    const client = new ApiClient('http://api.test');
    const streamedResult = await client.streamResearch(
      { query: '帮我写一段力扣代码' },
      { onAnswerDelta: (delta) => deltas.push(delta) },
    );

    assert.deepEqual(deltas, ['```python\n', 'print("ok")\n```']);
    assert.deepEqual(streamedResult, result);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
