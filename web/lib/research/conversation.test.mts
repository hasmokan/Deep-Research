import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendResearchActivityStatus,
  applyResearchRunToActivityMessage,
  buildResearchRequestMessages,
  createAssistantResultMessage,
  createAssistantResearchActivityMessage,
  createUserMessage,
  completeResearchActivityMessage,
  setResearchActivityRunId,
  stopRunningResearchActivityMessage,
} from './conversation.ts';

const completedResult = {
  query: '做研究',
  documents: [],
  analysis: 'Research work is iterative and requires focused questions.',
  report: '# 做研究报告\n\n研究需要不断阅读、反思，并逐步收敛问题。',
  status: 'completed',
};

test('buildResearchRequestMessages serializes prior chat turns for backend context', () => {
  const userMessage = createUserMessage('做研究');
  const assistantMessage = createAssistantResultMessage(completedResult);

  const history = buildResearchRequestMessages([userMessage, assistantMessage]);

  assert.deepEqual(
    history.map((message) => message.role),
    ['user', 'assistant'],
  );
  assert.equal(history[0].content, '做研究');
  assert.match(history[1].content, /Research report for "做研究"/);
  assert.match(history[1].content, /研究需要不断阅读/);
});

test('buildResearchRequestMessages keeps only recent bounded history', () => {
  const messages = [
    createUserMessage('old 1'),
    createUserMessage('old 2'),
    createUserMessage('old 3'),
    createUserMessage('old 4'),
    createUserMessage('old 5'),
  ];

  const history = buildResearchRequestMessages(messages, { maxMessages: 3, maxContentLength: 5 });

  assert.deepEqual(
    history.map((message) => message.content),
    ['old 3', 'old 4', 'old 5'],
  );
});

test('assistant research activity messages keep stream status for session restore', () => {
  const activityMessage = createAssistantResearchActivityMessage('青稞市场占有率', {
    id: 'assistant-activity-1',
    now: '2026-05-16T10:00:00.000Z',
  });
  const updatedMessage = appendResearchActivityStatus(
    activityMessage,
    {
      stage: 'search',
      label: 'Searching',
      message: 'Searching the web for useful sources.',
    },
    '2026-05-16T10:01:00.000Z',
  );

  assert.equal(updatedMessage.role, 'assistant');
  assert.equal(updatedMessage.researchActivity?.query, '青稞市场占有率');
  assert.equal(updatedMessage.researchActivity?.status, 'running');
  assert.equal(updatedMessage.researchActivity?.streamStatuses.length, 1);
  assert.equal(updatedMessage.researchActivity?.updatedAt, '2026-05-16T10:01:00.000Z');
});

test('research activity stores backend run id for later restoration', () => {
  const activityMessage = createAssistantResearchActivityMessage('青稞市场占有率', {
    id: 'assistant-activity-1',
    now: '2026-05-16T10:00:00.000Z',
  });

  const updatedMessage = setResearchActivityRunId(
    activityMessage,
    'run-123',
    '2026-05-16T10:00:05.000Z',
  );

  assert.equal(updatedMessage.researchActivity?.runId, 'run-123');
  assert.equal(updatedMessage.researchActivity?.updatedAt, '2026-05-16T10:00:05.000Z');
});

test('applyResearchRunToActivityMessage rebuilds activity trace and completed result', () => {
  const activityMessage = createAssistantResearchActivityMessage('做研究', {
    id: 'assistant-activity-1',
    now: '2026-05-16T10:00:00.000Z',
  });

  const restoredMessage = applyResearchRunToActivityMessage(activityMessage, {
    run_id: 'run-123',
    query: '做研究',
    status: 'completed',
    created_at: '2026-05-16T10:00:00.000Z',
    updated_at: '2026-05-16T10:02:00.000Z',
    events: [
      {
        run_id: 'run-123',
        event: 'metadata',
        data: { run_id: 'run-123' },
        seq: 1,
        created_at: '2026-05-16T10:00:00.000Z',
      },
      {
        run_id: 'run-123',
        event: 'status',
        data: {
          stage: 'search',
          label: 'Searching',
          message: 'Searching the web.',
        },
        seq: 2,
        created_at: '2026-05-16T10:00:01.000Z',
      },
      {
        run_id: 'run-123',
        event: 'complete',
        data: completedResult,
        seq: 3,
        created_at: '2026-05-16T10:02:00.000Z',
      },
    ],
  });

  assert.equal(restoredMessage.researchActivity?.runId, 'run-123');
  assert.equal(restoredMessage.researchActivity?.streamStatuses.length, 1);
  assert.equal(restoredMessage.researchActivity?.status, 'completed');
  assert.equal(restoredMessage.result?.report, completedResult.report);
});

test('completed research activity keeps trace and becomes result history', () => {
  const activityMessage = appendResearchActivityStatus(
    createAssistantResearchActivityMessage('做研究', {
      id: 'assistant-activity-1',
      now: '2026-05-16T10:00:00.000Z',
    }),
    {
      stage: 'report',
      label: 'Writing',
      message: 'Writing the final report.',
    },
    '2026-05-16T10:01:00.000Z',
  );

  const completedMessage = completeResearchActivityMessage(
    activityMessage,
    completedResult,
    '2026-05-16T10:02:00.000Z',
  );
  const history = buildResearchRequestMessages([
    createUserMessage('做研究'),
    completedMessage,
  ]);

  assert.equal(completedMessage.result?.report, completedResult.report);
  assert.equal(completedMessage.researchActivity?.status, 'completed');
  assert.equal(completedMessage.researchActivity?.streamStatuses.length, 1);
  assert.match(history[1].content, /Research report for "做研究"/);
});

test('buildResearchRequestMessages skips activity-only assistant messages', () => {
  const userMessage = createUserMessage('做研究');
  const activityMessage = createAssistantResearchActivityMessage('做研究', {
    id: 'assistant-activity-1',
    now: '2026-05-16T10:00:00.000Z',
  });

  const history = buildResearchRequestMessages([userMessage, activityMessage]);

  assert.deepEqual(
    history.map((message) => message.content),
    ['做研究'],
  );
});

test('stopRunningResearchActivityMessage marks restored running work as stopped', () => {
  const activityMessage = createAssistantResearchActivityMessage('做研究', {
    id: 'assistant-activity-1',
    now: '2026-05-16T10:00:00.000Z',
  });

  const stoppedMessage = stopRunningResearchActivityMessage(
    activityMessage,
    '2026-05-16T10:05:00.000Z',
  );

  assert.equal(stoppedMessage.researchActivity?.status, 'stopped');
  assert.equal(stoppedMessage.researchActivity?.updatedAt, '2026-05-16T10:05:00.000Z');
});
