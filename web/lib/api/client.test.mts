import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-expect-error Node's test runner imports the TypeScript source directly here.
import { ApiClient } from './client.ts';
import type { ResearchPlanResponse, ResearchPlanStreamStatus } from './types';

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
