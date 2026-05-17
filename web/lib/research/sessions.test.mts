import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createResearchSessionFromServerThread,
  createResearchSession,
  loadResearchSessionSnapshot,
  saveResearchSessionSnapshot,
  updateResearchSessionMessages,
  upsertResearchSession,
} from './sessions.ts';
import { createAssistantResultMessage, createUserMessage } from './conversation.ts';

const completedResult = {
  query: '做研究',
  documents: [],
  analysis: 'analysis',
  report: '# 做研究报告',
  status: 'completed',
};

function createMemoryStorage(initialValue?: string) {
  let value = initialValue ?? null;

  return {
    getItem() {
      return value;
    },
    setItem(_key: string, nextValue: string) {
      value = nextValue;
    },
  };
}

test('updateResearchSessionMessages derives title and latest result from messages', () => {
  const session = createResearchSession({
    id: 'session-1',
    now: '2026-05-16T10:00:00.000Z',
  });
  const messages = [
    createUserMessage('Deep research source quality roadmap'),
    createAssistantResultMessage(completedResult),
  ];

  const updatedSession = updateResearchSessionMessages(session, messages, '2026-05-16T10:01:00.000Z');

  assert.equal(updatedSession.title, 'Deep research source quality roadmap');
  assert.equal(updatedSession.latestResult?.report, '# 做研究报告');
  assert.equal(updatedSession.updatedAt, '2026-05-16T10:01:00.000Z');
});

test('upsertResearchSession keeps sessions sorted by recent activity', () => {
  const older = createResearchSession({
    id: 'older',
    now: '2026-05-16T10:00:00.000Z',
  });
  const newer = createResearchSession({
    id: 'newer',
    now: '2026-05-16T10:05:00.000Z',
  });

  const snapshot = upsertResearchSession(
    { activeSessionId: 'older', sessions: [older] },
    newer,
  );

  assert.deepEqual(
    snapshot.sessions.map((session) => session.id),
    ['newer', 'older'],
  );
});

test('loadResearchSessionSnapshot returns saved sessions and ignores invalid storage', () => {
  const session = createResearchSession({
    id: 'session-1',
    now: '2026-05-16T10:00:00.000Z',
  });
  const storage = createMemoryStorage();

  saveResearchSessionSnapshot(storage, {
    activeSessionId: 'session-1',
    sessions: [session],
  });

  assert.equal(loadResearchSessionSnapshot(storage).activeSessionId, 'session-1');
  assert.equal(loadResearchSessionSnapshot(createMemoryStorage('{')).sessions.length, 0);
});

test('createResearchSessionFromServerThread restores persisted conversation messages', () => {
  const session = createResearchSessionFromServerThread({
    thread_id: 'thread-1',
    title: '青稞市场',
    created_at: '2026-05-17T00:00:00.000Z',
    updated_at: '2026-05-17T00:01:00.000Z',
    messages: [
      {
        id: 'user-1',
        role: 'user',
        content: '查青稞',
        createdAt: '2026-05-17T00:00:00.000Z',
      },
      { invalid: true },
    ],
  });

  assert.equal(session.id, 'thread-1');
  assert.equal(session.title, '青稞市场');
  assert.equal(session.messages.length, 1);
  assert.equal(session.messages[0].content, '查青稞');
});
