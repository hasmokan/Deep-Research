import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiClient } from './client.ts';
import type {
  AgentMessage,
  ResearchPlanResponse,
  ResearchPlanStreamStatus,
  ResearchResult,
  ResearchStreamStatus,
  TokenUsage,
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

test('request methods attach a request id header', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'http://api.test/api/research/threads');
    const requestId = init?.headers && new Headers(init.headers).get('X-Request-ID');
    assert.match(requestId ?? '', /^req-/);

    return Response.json([]);
  };

  try {
    const client = new ApiClient('http://api.test');

    await client.listResearchThreads();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reportClientError posts diagnostics with request context', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body?: string | null; requestId: string | null }> = [];

  globalThis.fetch = async (url, init) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      body: init?.body?.toString() ?? null,
      requestId: init?.headers ? new Headers(init.headers).get('X-Request-ID') : null,
    });

    return Response.json({ ok: true, request_id: 'trace-client' });
  };

  try {
    const client = new ApiClient('http://api.test');
    client.setAccessTokenProvider(() => 'token-123');

    await client.reportClientError({
      message: 'Rendered report failed',
      source: 'window.onerror',
      level: 'error',
      run_id: 'run-123',
      context: { component: 'ReportSidebar' },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, 'http://api.test/api/diagnostics/client-error');
  assert.equal(calls[0]?.method, 'POST');
  assert.match(calls[0]?.requestId ?? '', /^req-/);
  const body = JSON.parse(calls[0]?.body ?? '{}');
  assert.equal(body.message, 'Rendered report failed');
  assert.equal(body.source, 'window.onerror');
  assert.equal(body.level, 'error');
  assert.equal(body.run_id, 'run-123');
  assert.deepEqual(body.context, { component: 'ReportSidebar' });
});

test('skill management methods call the skill endpoints', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body?: string | null }> = [];

  globalThis.fetch = async (url, init) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      body: init?.body?.toString() ?? null,
    });

    if (String(url).endsWith('/api/skills') && (!init?.method || init.method === 'GET')) {
      return Response.json([
        {
          name: 'identity-research',
          description: 'Identity guidance.',
          content: 'Ask for clarification when ambiguous.',
          allowed_tools: ['web_search'],
          enabled: true,
        },
      ]);
    }

    if (init?.method === 'DELETE') {
      return Response.json({ deleted: true });
    }

    return Response.json({
      name: 'identity-research',
      description: 'Identity guidance.',
      content: 'Ask for clarification when ambiguous.',
      allowed_tools: ['web_search'],
      enabled: String(url).endsWith('/enabled') ? false : true,
    });
  };

  try {
    const client = new ApiClient('http://api.test');

    await client.listAgentSkills();
    await client.upsertAgentSkill('identity-research', {
      description: 'Identity guidance.',
      content: 'Ask for clarification when ambiguous.',
      allowed_tools: ['web_search'],
    });
    await client.setAgentSkillEnabled('identity-research', false);
    await client.deleteAgentSkill('identity-research');
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(calls, [
    { url: 'http://api.test/api/skills', method: 'GET', body: null },
    {
      url: 'http://api.test/api/skills/identity-research',
      method: 'PUT',
      body: JSON.stringify({
        description: 'Identity guidance.',
        content: 'Ask for clarification when ambiguous.',
        allowed_tools: ['web_search'],
      }),
    },
    {
      url: 'http://api.test/api/skills/identity-research/enabled',
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
    },
    { url: 'http://api.test/api/skills/identity-research', method: 'DELETE', body: null },
  ]);
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
        controller.enqueue(encoder.encode('event: custom\ndata: {"type":"status","data":{"stage":"search","label":"Searching","message":"Searching web."}}\n\n'));
        controller.enqueue(encoder.encode(`event: values\ndata: ${JSON.stringify(result)}\n\n`));
        controller.enqueue(encoder.encode('event: end\ndata: null\n\n'));
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
        controller.enqueue(encoder.encode(`event: messages\ndata: ${JSON.stringify(aiMessage)}\n\n`));
        controller.enqueue(encoder.encode(`event: messages\ndata: ${JSON.stringify(toolMessage)}\n\n`));
        controller.enqueue(encoder.encode(`event: values\ndata: ${JSON.stringify(result)}\n\n`));
        controller.enqueue(encoder.encode('event: end\ndata: null\n\n'));
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
        controller.enqueue(encoder.encode('event: custom\ndata: {"type":"answer_delta","data":{"delta":"```python\\n"}}\n\n'));
        controller.enqueue(encoder.encode('event: custom\ndata: {"type":"answer_delta","data":{"delta":"print(\\"ok\\")\\n```"}}\n\n'));
        controller.enqueue(encoder.encode(`event: values\ndata: ${JSON.stringify(result)}\n\n`));
        controller.enqueue(encoder.encode('event: end\ndata: null\n\n'));
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

test('streamResearch forwards token usage updates and returns final usage', async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  const tokenUsageUpdates: TokenUsage[] = [];
  const tokenUsage: TokenUsage = {
    input_tokens: 11,
    output_tokens: 7,
    total_tokens: 18,
  };
  const result: ResearchResult = {
    query: '刷机有什么用',
    documents: [],
    analysis: null,
    report: null,
    answer: '刷机可以更新系统、救砖或获得更多控制权。',
    result_type: 'answer',
    status: 'completed',
    token_usage: tokenUsage,
  };

  globalThis.fetch = async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`event: custom\ndata: ${JSON.stringify({ type: 'token_usage', data: tokenUsage })}\n\n`));
        controller.enqueue(encoder.encode(`event: values\ndata: ${JSON.stringify(result)}\n\n`));
        controller.enqueue(encoder.encode('event: end\ndata: null\n\n'));
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
      { query: '刷机有什么用' },
      { onTokenUsage: (usage) => tokenUsageUpdates.push(usage) },
    );

    assert.deepEqual(tokenUsageUpdates, [tokenUsage]);
    assert.deepEqual(streamedResult, result);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamResearch consumes DeerFlow-style messages custom values and end events', async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  const agentMessages: AgentMessage[] = [];
  const traces: string[] = [];
  const tokenUsageUpdates: TokenUsage[] = [];
  const tokenUsage: TokenUsage = {
    input_tokens: 12,
    output_tokens: 8,
    total_tokens: 20,
  };
  const result: ResearchResult = {
    query: '刷机有什么用',
    documents: [],
    analysis: null,
    report: null,
    answer: '刷机可以更新系统、救砖或获得更多控制权。',
    result_type: 'answer',
    status: 'completed',
    token_usage: tokenUsage,
  };
  const aiMessage: AgentMessage = {
    type: 'ai',
    id: 'ai-1',
    content: '刷机可以更新系统',
    tool_calls: [],
  };

  globalThis.fetch = async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`event: messages\ndata: ${JSON.stringify(aiMessage)}\n\n`));
        controller.enqueue(encoder.encode('event: custom\ndata: {"type":"trace","data":{"id":"react-step","stage":"react","kind":"reasoning","title":"Select next action","detail":"Choosing next step."}}\n\n'));
        controller.enqueue(encoder.encode(`event: custom\ndata: ${JSON.stringify({ type: 'token_usage', data: tokenUsage })}\n\n`));
        controller.enqueue(encoder.encode(`event: values\ndata: ${JSON.stringify(result)}\n\n`));
        controller.enqueue(encoder.encode('event: end\ndata: null\n\n'));
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
      { query: '刷机有什么用' },
      {
        onAgentMessage: (message) => agentMessages.push(message),
        onTrace: (trace) => traces.push(trace.title),
        onTokenUsage: (usage) => tokenUsageUpdates.push(usage),
      },
    );

    assert.deepEqual(agentMessages, [aiMessage]);
    assert.deepEqual(traces, ['Select next action']);
    assert.deepEqual(tokenUsageUpdates, [tokenUsage]);
    assert.deepEqual(streamedResult, result);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
