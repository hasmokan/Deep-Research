import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createResearchSession,
  loadResearchSessionSnapshot,
  restoreLocalResearchSessionState,
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

const answerResult = {
  query: '来源是？',
  documents: [],
  analysis: null,
  report: null,
  answer: '上一份报告使用了这些来源。',
  result_type: 'answer' as const,
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

test('updateResearchSessionMessages keeps latest report artifact when a follow-up answer is appended', () => {
  const session = createResearchSession({
    id: 'session-1',
    now: '2026-05-16T10:00:00.000Z',
  });
  const messages = [
    createUserMessage('Deep research source quality roadmap'),
    createAssistantResultMessage(completedResult),
    createUserMessage('来源是？'),
    createAssistantResultMessage(answerResult),
  ];

  const updatedSession = updateResearchSessionMessages(session, messages, '2026-05-16T10:02:00.000Z');

  assert.equal(updatedSession.latestResult?.report, '# 做研究报告');
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

test('restoreLocalResearchSessionState uses only local storage when no sessions are saved', () => {
  const restored = restoreLocalResearchSessionState(createMemoryStorage());

  assert.equal(restored.activeSessionId, null);
  assert.equal(restored.activeSession, null);
  assert.deepEqual(restored.sessions, []);
});

test('restoreLocalResearchSessionState restores the local active session', () => {
  const older = createResearchSession({
    id: 'older',
    now: '2026-05-16T10:00:00.000Z',
  });
  const newer = createResearchSession({
    id: 'newer',
    now: '2026-05-16T10:05:00.000Z',
  });
  const storage = createMemoryStorage();

  saveResearchSessionSnapshot(storage, {
    activeSessionId: 'older',
    sessions: [newer, older],
  });

  const restored = restoreLocalResearchSessionState(storage);

  assert.equal(restored.activeSessionId, 'older');
  assert.equal(restored.activeSession?.id, 'older');
  assert.deepEqual(
    restored.sessions.map((session) => session.id),
    ['newer', 'older'],
  );
});
